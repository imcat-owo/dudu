/**
 * 照片涂鸦 — on-device composer.
 *
 * Renders the photo + SVG doodle overlay inside a hidden ViewShot and
 * captures a REAL composited PNG. Mount <DoodleComposerHost/> once
 * (local-app.tsx, off-screen like AIBrowserView); the AI tool calls
 * requestDoodleCompose() and gets back a file URI.
 *
 * The overlay shapes come from doodleRenderSpec() — the same specs the
 * SVG string builder uses, so device output and node-test SVG agree.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Image, View } from "react-native";
import Svg, { Defs, Ellipse, G, Line, Marker, Path, Text as SvgText } from "react-native-svg";
import ViewShot, { type ViewShotRef } from "react-native-view-shot";
import { doodleRenderSpec, type DoodleAction, type DoodleShape } from "./doodle";

export interface DoodleComposeResult {
  uri: string;
  width: number;
  height: number;
}

interface DoodleJob {
  photoUri: string;
  width: number;
  height: number;
  actions: DoodleAction[];
  resolve: (r: DoodleComposeResult) => void;
  reject: (e: Error) => void;
}

let queuedJob: DoodleJob | null = null;
let notifyHost: (() => void) | null = null;

/**
 * Compose a doodled photo. Requires <DoodleComposerHost/> mounted —
 * rejects honestly when it isn't (never fakes an image).
 */
export function requestDoodleCompose(
  photoUri: string,
  width: number,
  height: number,
  actions: DoodleAction[],
): Promise<DoodleComposeResult> {
  return new Promise((resolve, reject) => {
    if (!photoUri) {
      reject(new Error("No photo to doodle on."));
      return;
    }
    if (queuedJob) {
      reject(new Error("A doodle is already being composed — one at a time."));
      return;
    }
    queuedJob = { photoUri, width, height, actions, resolve, reject };
    // If the host was never mounted, fail loudly instead of hanging.
    setTimeout(() => {
      if (queuedJob) {
        const j = queuedJob;
        queuedJob = null;
        j.reject(new Error("Doodle composer is not ready (host not mounted)."));
      }
    }, 15000);
    notifyHost?.();
  });
}

function shapeKey(s: DoodleShape): string {
  switch (s.type) {
    case "heart":
      return `heart-${s.cx}-${s.cy}-${s.scale}`;
    case "circle":
      return `circle-${s.cx}-${s.cy}-${s.rx}`;
    case "arrow":
      return `arrow-${s.x1}-${s.y1}-${s.x2}-${s.y2}`;
    case "text":
      return `text-${s.x}-${s.y}-${s.text}`;
  }
}

function DoodleShapes({ shapes }: { shapes: DoodleShape[] }) {
  return (
    <>
      {shapes.map((s) => {
        const key = shapeKey(s);
        switch (s.type) {
          case "heart":
            return (
              <G
                key={key}
                x={s.cx}
                y={s.cy}
                scale={s.scale}
                rotation={-8}
                originX={0}
                originY={0}
              >
                <Path d={s.heartPath} fill={s.color} fillOpacity={0.92} stroke="#ffffff" strokeWidth={0.06} />
              </G>
            );
          case "circle":
            return (
              <Ellipse
                key={key}
                cx={s.cx}
                cy={s.cy}
                rx={s.rx}
                ry={s.ry}
                fill="none"
                stroke={s.color}
                strokeWidth={s.strokeWidth}
                strokeLinecap="round"
              />
            );
          case "arrow":
            return (
              <G key={key}>
                <Defs>
                  <Marker id={s.markerId} markerWidth={8} markerHeight={8} refX={6} refY={4} orient="auto">
                    <Path d="M0,0 L8,4 L0,8 Z" fill={s.color} />
                  </Marker>
                </Defs>
                <Line
                  x1={s.x1}
                  y1={s.y1}
                  x2={s.x2}
                  y2={s.y2}
                  stroke={s.color}
                  strokeWidth={s.strokeWidth}
                  strokeLinecap="round"
                  markerEnd={`url(#${s.markerId})`}
                />
              </G>
            );
          case "text":
            return (
              <SvgText
                key={key}
                x={s.x}
                y={s.y}
                fontSize={s.fontSize}
                fill={s.color}
                fontWeight="700"
                textAnchor="middle"
                stroke={s.halo}
                strokeWidth={s.haloWidth}
                transform={`rotate(-4 ${s.x} ${s.y})`}
              >
                {s.text}
              </SvgText>
            );
          default:
            return null;
        }
      })}
    </>
  );
}

/**
 * Mount once, off-screen. Picks up queued jobs, renders photo+doodles
 * at real size, captures, resolves. Null when idle (zero cost).
 */
export function DoodleComposerHost() {
  const [job, setJob] = useState<DoodleJob | null>(null);
  const [shapes, setShapes] = useState<DoodleShape[]>([]);
  const shotRef = useRef<ViewShotRef>(null);
  const jobRef = useRef<DoodleJob | null>(null);

  useEffect(() => {
    notifyHost = () => setJob(queuedJob);
    return () => {
      notifyHost = null;
    };
  }, []);

  const finish = useCallback((j: DoodleJob, err: Error | null, uri?: string) => {
    if (queuedJob === j) queuedJob = null;
    jobRef.current = null;
    setJob(null);
    setShapes([]);
    if (err || !uri) j.reject(err ?? new Error("Doodle capture failed."));
    else j.resolve({ uri, width: j.width, height: j.height });
  }, []);

  // When a job arrives: compute shapes, wait a beat for the image to
  // lay out, then capture.
  useEffect(() => {
    if (!job) return;
    jobRef.current = job;
    setShapes(doodleRenderSpec(job.width, job.height, job.actions));
    const t = setTimeout(() => {
      const j = jobRef.current;
      if (!j) return;
      void shotRef.current
        ?.capture?.()
        .then((uri) => finish(j, null, uri))
        .catch((e: unknown) => finish(j, e instanceof Error ? e : new Error(String(e))));
    }, 600);
    return () => clearTimeout(t);
  }, [job, finish]);

  if (!job) return null;
  return (
    <ViewShot
      ref={shotRef}
      options={{ format: "png", quality: 0.95, result: "tmpfile" }}
      style={{ width: job.width, height: job.height }}
    >
      <View style={{ width: job.width, height: job.height }}>
        <Image
          source={{ uri: job.photoUri }}
          style={{ width: job.width, height: job.height, position: "absolute" }}
          resizeMode="stretch"
        />
        <Svg width={job.width} height={job.height} style={{ position: "absolute" }}>
          <DoodleShapes shapes={shapes} />
        </Svg>
      </View>
    </ViewShot>
  );
}
