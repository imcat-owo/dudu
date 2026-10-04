/**
 * Capability router — decide WHICH model handles an attachment.
 *
 * Input-type routing (vision doc §1, aligned with HF Chat-UI LLM Router +
 * opencode-vision-analyze fast path):
 *
 *   1. Fast path: the current chat model handles it itself — native vision
 *      (zero extra calls) or its own describe config. No routing, no cost.
 *   2. Routed: an enabled capability group for the attachment type exists
 *      (image_input / voice_input) — walk its members in order (primary
 *      first, then fallbacks, LiteLLM-style). First success wins.
 *   3. Honest failure: nothing configured or everything failed — fail LOUD
 *      with guidance. Never silently drop the attachment, never let the
 *      model hallucinate an answer (ClawAI's drop+warn lesson).
 *
 * Output-type (image_output / video) is a tool backend, not routing —
 * see ../image/tools.ts and ../video/tools.ts.
 *
 * The decision is returned to the caller so the UI can show it
 * (HF RouterMetadata analog — automatic but never a black box).
 *
 * PURE module except for the injected group lookups — no network here.
 */

import {
  CAPABILITY_TAGS,
  type CapabilityGroup,
  type CapabilityGroupMember,
  type CapabilityTag,
} from "./capability-groups";
import type { ApiGroup } from "./types";

export interface ResolvedMember {
  member: CapabilityGroupMember;
  /** The borrowed connection. */
  apiGroup: ApiGroup;
  /** Effective model: member override wins, then the ApiGroup's chat model. */
  model: string;
}

export interface RouterDecision {
  routed: boolean;
  via: "native" | "current-describe" | "routed";
  groupId?: string;
  groupName?: string;
  modelName?: string;
}

export type VisionPlan =
  | { mode: "native"; decision: RouterDecision }
  | { mode: "describe-current"; decision: RouterDecision }
  | {
      mode: "routed";
      decision: RouterDecision;
      viaGroup: CapabilityGroup;
      candidates: ResolvedMember[];
    }
  | { mode: "unavailable"; reason: "no-vision-config" | "group-empty" | "routing-disabled" };

/** Resolve member ids against real ApiGroups, preserving order. Missing
 *  groups (deleted connections) are skipped, not fatal. */
export function resolveMembers(group: CapabilityGroup, apiGroups: ApiGroup[]): ResolvedMember[] {
  const out: ResolvedMember[] = [];
  for (const member of group.members) {
    const apiGroup = apiGroups.find((g) => g.id === member.groupId);
    if (!apiGroup) continue;
    out.push({
      member,
      apiGroup,
      model: member.model?.trim() || apiGroup.model,
    });
  }
  return out;
}

/** Find the enabled group serving a capability tag. First match wins. */
export function findCapabilityGroup(
  groups: CapabilityGroup[],
  tag: CapabilityTag,
): CapabilityGroup | null {
  return groups.find((g) => g.enabled && g.tag === tag) ?? null;
}

/**
 * Plan how to handle image attachments for this turn.
 *
 * Order (her 开启原则 + alignment research §2.2):
 * current model first (fast path) → capability group → honest failure.
 */
export function planVision(
  current: ApiGroup | null,
  capGroups: CapabilityGroup[],
  apiGroups: ApiGroup[],
  routingEnabled: boolean,
): VisionPlan {
  if (!current) return { mode: "unavailable", reason: "no-vision-config" };

  // 1. Fast path — the current model sees images itself.
  if (current.vision?.native) {
    return {
      mode: "native",
      decision: { routed: false, via: "native", modelName: current.model },
    };
  }
  // 2. The current model's own describe config.
  if (current.vision) {
    return {
      mode: "describe-current",
      decision: {
        routed: false,
        via: "current-describe",
        modelName: current.vision.model?.trim() || current.model,
      },
    };
  }
  // 3. Capability routing — only when she left it on.
  if (!routingEnabled) return { mode: "unavailable", reason: "routing-disabled" };
  const group = findCapabilityGroup(capGroups, CAPABILITY_TAGS.IMAGE_INPUT);
  if (!group) return { mode: "unavailable", reason: "group-empty" };
  const candidates = resolveMembers(group, apiGroups);
  if (candidates.length === 0) return { mode: "unavailable", reason: "group-empty" };
  const primary = candidates[0];
  return {
    mode: "routed",
    decision: {
      routed: true,
      via: "routed",
      groupId: group.id,
      groupName: group.name || group.tag,
      modelName: primary.model,
    },
    viaGroup: group,
    candidates,
  };
}

/**
 * Ordered STT candidates for a voice message: the dialog's own group
 * first, then the voice_input capability group members, then nothing —
 * the dedicated STT endpoint config (stt.ts) is tried by the caller after
 * these, preserving its existing position in the chain.
 */
export function planVoiceInput(
  current: ApiGroup | null,
  capGroups: CapabilityGroup[],
  apiGroups: ApiGroup[],
  routingEnabled: boolean,
): ApiGroup[] {
  const out: ApiGroup[] = [];
  const seen = new Set<string>();
  const push = (g: ApiGroup) => {
    if (!seen.has(g.id)) {
      seen.add(g.id);
      out.push(g);
    }
  };
  if (current) push(current);
  if (routingEnabled) {
    const group = findCapabilityGroup(capGroups, CAPABILITY_TAGS.VOICE_INPUT);
    if (group) {
      for (const c of resolveMembers(group, apiGroups)) {
        // Voice members borrow the connection; STT always uses the
        // member's effective model only as a label — the wire call is
        // /audio/transcriptions on the borrowed base URL.
        push(c.apiGroup);
      }
    }
  }
  return out;
}

/** Human-readable one-liner for the description-block trace. */
export function describeVia(decision: RouterDecision): string | null {
  if (!decision.routed) return null;
  const who = decision.modelName ? `模型 ${decision.modelName}` : "分组模型";
  const where = decision.groupName ? `（分组「${decision.groupName}」）` : "";
  return `经${who}${where}识图`;
}
