# Ideas & Open Questions

## 1. Always-On Hosting

**Problem:** The agent only works when the Mac is running. We want to text a dedicated Apple ID anytime and get reminders managed 24/7.

### Options

**A. Mac as thin relay + HF serverless inference (recommended if keeping iMessage)**
- Mac Mini runs 24/7 as a dumb iMessage bridge (~10W, ~$1/mo electricity)
- Replace Ollama with HF Inference Providers (serverless, OpenAI-compatible API)
- Qwen3, Llama3, DeepSeek all support tool calling
- Cost: ~$1-5/month (pay-per-token)
- Mac needs no GPU, just network + iMessage

**B. HF Spaces with GPU**
- Full agent on HF Spaces with Docker
- Requires switching from iMessage to Telegram/Discord/WhatsApp (no macOS on cloud)
- Cost: $292+/month for GPU tier -- overkill for personal use

**C. HF Inference Endpoints (dedicated)**
- Always-on dedicated GPU, $0.50/hr ($365/mo) or scale-to-zero (~$50-100/mo)
- Still needs Mac for iMessage relay

**D. Switch to Telegram + HF Spaces (cheapest)**
- Replace iMessage entirely with Telegram Bot API (free, works on any Linux server)
- Deploy to HF Spaces free CPU tier or $7/mo for persistent storage
- No Mac needed at all
- Cost: $0-7/month

### Decision
- TBD. Depends on whether we want to keep iMessage or are okay switching to Telegram.

---

## 2. Agent vs Simple Parser

**Problem:** Is an LLM agent overkill for a reminder app? Could a regex parser + templates do the job faster and cheaper?

### What a simple parser handles fine (~80% of messages)
- "Remind me to X at Y" -- regex + chrono-node extracts task and time
- "List reminders" / "Cancel reminder 2" -- keyword matching
- "Snooze 10 min" -- pattern match
- Responses are templated: "Got it, I'll remind you to X at Y"
- Fast (~1ms), free, no model dependency, works offline

### Where the LLM earns its keep (~20% of messages)
- "Change it to tomorrow" -- needs conversation context to resolve "it"
- "Actually nah" -- understanding cancellation from casual language
- "Remind me to go to bed at 12" -- AM/PM inference from context (bedtime = midnight)
- "Delete the second one and move gym to 5pm" -- multi-intent parsing
- Anything ambiguous, conversational, or context-dependent

### Options

**A. Keep full LLM agent (current)**
- Handles everything including edge cases
- Slower (2-5 sec per response), requires GPU/API
- More natural conversation

**B. Pure parser, no LLM**
- Fast, free, offline
- Breaks on ambiguity, context references, casual language
- Rigid -- user must follow expected patterns

**C. Hybrid: parser first, LLM fallback (best of both)**
- Parser handles clear commands instantly (~1ms)
- Falls back to LLM only when parser can't confidently classify
- 80% of messages never touch the LLM
- Keeps natural conversation for edge cases
- Reduces API cost and latency significantly

### Decision
- TBD. Hybrid approach seems like the sweet spot.

---

## 3. Future Ideas (not prioritized)

- Dedicated Apple ID for the agent (separate iMessage identity)
- Web dashboard to view/manage reminders
- Calendar integration (avoid scheduling reminders during events)
- Location-based reminders ("remind me when I get home")
- Natural language recurring patterns ("every other tuesday", "last friday of the month")
- Priority levels and categories
- Shared reminders (remind someone else via their number)
