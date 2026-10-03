# Motion / Splash / 我们的空间 — Alignment Research (2026-10-03)

> 她原话："让他们学学动态效果，开屏动画，我们的空间。去找对齐对象做。"
> Don't design from imagination alone — study best-in-class first.

## 1. Motion design — alignment targets

### Apple HIG Motion (primary)
Source: https://github.com/ichintansoni/skills-master/blob/HEAD/skills/apple/design/foundations/hig-motion/SKILL.md
- **Purposeful, not decorative.** Animate to show cause/effect, reveal hierarchy, guide attention. If cutting it doesn't break comprehension, cut it.
- **Preserve continuity.** Move elements along coherent paths; shared elements carry the eye between states. No hard cuts that lose the user's place.
- **Match motion to spatial structure.** Forward/back directions consistent; modals rise above content.
- **Keep timing tight and interruptible.** Short durations, natural easing. Let users tap through.
- **Never motion-only signal.** Pair with persistent visual change. Status must survive without movement.
- **Reduce Motion is first-class**, not a fallback — define the static equivalent.

### Timing & easing scale
Source: Apple HIG designer skill + Motionly docs
- Durations: 100ms micro-interactions · 200ms fast · 300ms normal · 500ms slow
- Ease-out for ENTERING (arrive fast, settle gently) — ~70% of animations
- Ease-in for LEAVING (accelerate away, don't linger)
- Ease-in-out for moving between on-screen positions
- **Spring physics over linear** — Apple's favorite for natural settle (tension 80–180)
- **Exit faster than enter** (~60–70%) — feels responsive
- **Stagger**: 30–50ms/char · 80–120ms/word (Apple uses 90ms) · 100–200ms/object

### Skill rules (ui-ux-pro-max quick-reference)
- `easing`: deceleration arriving, acceleration leaving
- `spring-physics`: prefer springs over linear/cubic-bezier
- `exit-faster-than-enter`: exit ~60–70% of enter
- `motion-consistency`: unify duration/easing tokens globally

### Applied to 我们的空间
`src/motion.ts` — DUR / SPRING / STAGGER / EASE tokens used app-wide.
- Tab content: FadeIn 300ms ease-out
- List items: StaggerIn 90ms stagger, 200ms ease-out (garden blooms, timeline unfolds)
- Press feedback: 0.97 scale, 100ms in / 65ms out
- Status pulse: 1600ms gentle loop (ambient, not distracting)

## 2. Splash animation — alignment targets

### Mobbin launch-screen catalog
Source: https://mobbin.com/glossary/launch-screen
- 6 patterns: fun illustration · solid brand color · product shot · **animated** · background image · illustration
- **Animated winners**: Netflix 'Tudum' (brand moment as ritual), (Not Boring) Weather (8s skippable preview that feels like launch), Burger King

### Best-practice examples
- **Instagram**: logo blooms/transforms into camera icon — brand identity + anticipation
- **Spotify**: logo + pulsing sound waves — essence of the product from first frame
- **WhatsApp**: rotating dots resolve into logo — playful anticipation
- **Benem spec** (detailed): shimmer band sweeps logo at 0.1s (0.8s one-shot) → fade out at 1.0s → dismiss at 1.5s. Reduce Motion → instant.

### Applied: `src/splash.tsx`
- Sora avatar (her finalized AI face) blooms via soft spring (0.82→1 scale)
- Shimmer band sweeps the avatar at 150ms (800ms, clipped to circle)
- Title 「我们的空间」 rises at 350ms, subtitle at 500ms (stagger)
- Cross-fade out at 1400ms (400ms ease-in), handover at 1800ms
- Warm gray canvas #FAF9F6 (theme not loaded at boot — hardcoded to match)
- Total ~1.8s — premium, not annoying

## 3. Intimate personal spaces — alignment targets

### Between (35M+ couples, highest-rated couple app)
Source: Play Store + Medium essays
- **"Minimalist, romantic design"** — no ads, no noise, just the two of them
- "A quiet, digital sanctuary" carved out from the loud public internet
- Core: private chat + **photo timeline of memories** + shared calendar + countdowns
- Milestones emphasized (weddings, anniversaries) — timeline as relationship story
- Takeaway: intimacy = **removal of noise** + **memory-first** + **milestone elevation**

### Applied to 我们的空间
- Timeline grouped by month with elegant headers — reads as a story, not a log
- Milestones get MoonStar accent marker + larger bolder type (Between's milestone elevation)
- Garden: three living confidence states with distinct visuals (bloom/sprout/ask)
- Empty states: warm + honest + invite dialog ("跟我说一声，我来记") — never fake sample data
- Header: heart + title + today's date — "a place for the two of us"

## 复用记录
- 2026-10-03: 初次研究 → motion.ts / splash.tsx / our-space-ui.tsx choreography
