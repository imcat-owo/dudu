/**
 * Read-only AI tool for capability groups ("分组").
 *
 * PURE module: no React Native imports. Stores are injected so node tests
 * can pass fakes; local-agent.ts wires the real singletons.
 *
 * Why this exists (audit round 2, AI-use P1-2): the AI was blind to
 * capability groups — it first met the concept inside a routing-failure
 * error message. Now it can answer "what's in my image-input group?".
 *
 * Read-only by design: she manages membership in Settings → 能力分组.
 * Only the 4 preset tags (image_input, image_output, video, voice_input)
 * are honored by the router — custom groups are inert organizers, and the
 * tool says so honestly instead of promising routing that can't happen.
 */

import { type CapabilityGroup, capabilityGroupDisplayName } from "./capability-groups.js";
import type { LocalTool } from "./local-tools.js";
import type { ApiGroup } from "./types.js";

export interface CapabilityGroupToolDeps {
  /** Translated preset name for a presetId (falls back to the id). */
  presetName: (presetId: string) => string;
  /** Live capability groups. */
  getCapabilityGroups: () => CapabilityGroup[];
  /** Live API groups, to resolve member groupId → name/model. */
  getApiGroups: () => ApiGroup[];
  /** Whether passive capability routing is currently on. */
  isRoutingEnabled: () => boolean;
}

export function createCapabilityGroupTools(deps: CapabilityGroupToolDeps): LocalTool[] {
  return [
    {
      name: "capability_groups_list",
      description:
        'List her capability groups ("分组") and their members — read-only. ' +
        "The 4 preset groups: image_input (input — messages with images route here when the current model can't see them), " +
        "voice_input (input — voice messages route here when the current model can't hear), " +
        "image_output (output — backend the generate_image tool calls), " +
        "video (output — backend the generate_video tool calls). " +
        "Only these 4 preset tags are honored by the router; custom groups are inert organizers. " +
        "Members are ordered: first = primary, rest = fallbacks. " +
        "Use when she asks what's in a group, or when a routing error mentions one. " +
        "You cannot change membership with this tool — she manages groups in Settings → 能力分组. " +
        "If a group she needs is empty, tell her which one and what kind of model to add.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      manualId: "api-groups",
      run: async () => {
        const groups = deps.getCapabilityGroups();
        const apiById = new Map(deps.getApiGroups().map((g) => [g.id, g]));
        const lines = groups.map((g) => {
          const name = capabilityGroupDisplayName(g, deps.presetName);
          const state = g.enabled ? "on" : "off";
          const memberLines = g.members.map((m, i) => {
            const api = apiById.get(m.groupId);
            const label = api
              ? `${api.name} / ${m.model ?? api.model}`
              : `(unknown connection ${m.groupId})`;
            const role = i === 0 ? "primary" : `fallback ${i}`;
            const ep = m.endpoint ? ` → ${m.endpoint}` : "";
            return `    - ${role}: ${label}${ep}`;
          });
          const members =
            memberLines.length > 0
              ? `\n${memberLines.join("\n")}`
              : " (empty — she hasn't added any models yet)";
          return `- ${name} [${g.tag}, ${g.kind}, ${state}]${members}`;
        });
        const header = `Capability groups (${groups.length}); routing ${deps.isRoutingEnabled() ? "ON" : "OFF"}:`;
        return [header, ...lines].join("\n");
      },
    },
  ];
}
