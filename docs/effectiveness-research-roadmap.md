# Michelangelo — Practical Roadmap for Better Learning

_Last updated: 2026-04-20_

## Why this document exists

You said the first draft felt too technical. This version is written for **builders**: PMs, founders, engineers, and architects.

Goal: help Michelangelo become not just a “good answer machine,” but a tool that helps people **remember more, connect ideas, and make better decisions**.

---

## 1) What “effective” should mean (in plain English)

For this product, “effective” should mean:

1. **People remember what they learned later** (not just right after the chat).
2. **People can apply ideas in new situations** (example: using a CS concept in a product decision).
3. **People make clearer decisions with evidence** (not just confidence).
4. **People connect ideas across fields** (math + CS + product + business constraints).

If we optimize only for “engagement” (longer chats), we can fool ourselves.

---

## 2) The core learning ideas (with simple explanations)

Below are proven ideas from learning science, translated into product actions.

### A) Retrieval practice

**What it means:** Ask people to recall from memory instead of re-reading.

**Why it matters:** Memory gets stronger when you pull information out, not when you only consume it.

**In-product move:** End each session with a few short recall questions.

---

### B) Spaced practice

**What it means:** Revisit ideas over time (for example: next day, next week, next month).

**Why it matters:** Spacing helps memory last.

**In-product move:** Auto-schedule revisit prompts for key concepts.

---

### C) Interleaving

**What it means:** Mix different types of problems instead of doing one type in a block.

**Why it matters:** Helps people choose the right strategy, not just repeat one pattern.

**In-product move:** Mix prompts (e.g., one algorithm question + one systems tradeoff + one product metric case).

---

### D) Worked examples

**What it means:** Show a step-by-step solved example before asking users to solve one alone.

**Why it matters:** Reduces overload, especially for newer learners.

**In-product move:** “Show one solved path → then ask user to complete a similar one.”

---

### E) Metacognition

**What it means:** Thinking about your own thinking.

**Why it matters:** Improves transfer (using ideas in new contexts).

**In-product move:** Add one quick reflection prompt: “What changed in your understanding?”

---

### F) Productive failure

**What it means:** Let users try first (and struggle a bit), then teach.

**Why it matters:** Can improve deep understanding.

**In-product move:** Before revealing the full answer, ask: “What is your best current guess?”

---

### G) Avoid the “learning styles” trap

**What it means:** “Visual learner vs auditory learner” personalization is not strongly supported by evidence.

**In-product move:** Personalize by what is actually useful:
- prior knowledge,
- goals,
- past performance,
- repeated mistakes.

---

## 3) A simple Learning Mode for Michelangelo

Use this 5-step flow after each meaningful research turn.

1. **Before answer (30–60 sec):**
   - User writes current belief.
   - User gives confidence score (0–100).
2. **Answer + evidence:**
   - Assistant gives answer with sources.
   - If complex topic, include one worked example.
3. **Quick check (2 minutes):**
   - 3 recall questions.
   - 1 transfer question (“Use this idea in a different domain”).
4. **Auto follow-up:**
   - Schedule review at Day 1, Day 7, Day 30.
5. **Reflection:**
   - “What changed?” and “What still feels unclear?”

This turns passive reading into active learning.

---

## 4) What to build first (priority order)

### Tier 1 — High value, lower effort

1. **Session-end Recall Drill**
   - Generate 3–5 recall questions from the session.
2. **Spaced Revisit Queue**
   - “Due today / due this week” list on home screen.
3. **Confidence Tracking**
   - Capture confidence before and after.
4. **Transfer Prompt**
   - One “apply this elsewhere” prompt each session.

### Tier 2 — Medium effort

5. **Worked Example Progression**
   - Solved example, then partial problem, then independent problem.
6. **Interleaved Practice Builder**
   - Mixed concept sets across sessions.
7. **Misconception Alerts**
   - Detect repeated errors and offer correction cards.

### Tier 3 — Larger investments

8. **Cross-discipline Challenge Mode**
   - Scenario combining CS, math, and product constraints.
9. **Graph Path Challenges**
   - Explain concept path from A to B with supporting evidence.

---

## 5) How to measure real success

### Learning quality metrics

- **Delayed recall:** accuracy at Day 1 / Day 7 / Day 30.
- **Transfer performance:** score on “new context” prompts.
- **Calibration:** how close confidence is to actual correctness.

### Decision quality metrics

- **Decision clarity:** clear options, assumptions, tradeoffs.
- **Evidence quality:** decisions cite relevant sources.
- **Time-to-decision:** faster decisions without quality drop.

### Guardrails

Do **not** optimize only for:
- message count,
- session length,
- “feels smart” responses.

Optimize for: “Can users learn, apply, and decide better?”

---

## 6) 30 / 60 / 90 day execution plan

### Days 1–30

- Launch Recall Drill + Confidence Tracking.
- A/B test: baseline vs baseline+recall.
- Target: meaningful lift in Day-7 recall.

### Days 31–60

- Launch Spaced Revisit Queue.
- Add one transfer question to each revisit.
- Target: lift in Day-30 recall + transfer score.

### Days 61–90

- Add worked example progression for CS/math-heavy topics.
- Add interleaved practice sets.
- Target: better transfer without lowering completion.

---

## 7) Risks and practical fixes

1. **Too much friction** (users feel slowed down)
   - Keep “learning mode” lightweight and optional.
2. **Quiz fatigue**
   - Limit checks to a few short prompts.
3. **False confidence**
   - Force a recall attempt before showing model answer.
4. **Weak cross-domain links**
   - Require citations and allow users to reject bad links.

---

## 8) If you do only one thing next

Add a short, consistent checkpoint after each strong session:

> **2-minute recall + 1 transfer question + automatic spaced follow-ups.**

This is the highest-leverage change to move from “good chat” to “real learning.”

---

## 9) Glossary (plain language)

- **Retrieval practice:** remembering from memory instead of re-reading notes.
- **Spaced practice:** revisiting ideas over time.
- **Interleaving:** mixing different kinds of problems in one set.
- **Worked example:** a fully solved step-by-step example.
- **Metacognition:** noticing how your understanding is changing.
- **Transfer:** using a concept in a new context.
- **Calibration:** whether your confidence matches your actual correctness.

---

## Sources

1. Roediger, H. L., & Karpicke, J. D. (2006). *Test-Enhanced Learning*. Psychological Science. https://journals.sagepub.com/doi/10.1111/j.1467-9280.2006.01693.x
2. Cepeda, N. J., et al. (2006). *Distributed practice in verbal recall tasks: A review and quantitative synthesis*. Psychological Bulletin. https://pubmed.ncbi.nlm.nih.gov/16719566/
3. Dunlosky, J., et al. (2013). *Improving Students’ Learning With Effective Learning Techniques*. Psychological Science in the Public Interest. https://journals.sagepub.com/stoken/rbtfl/Z10jaVH/60XQM/full
4. Sweller, J., & Cooper, G. A. (1985). *The use of worked examples as a substitute for problem solving in learning algebra*. Cognition and Instruction. https://www.tandfonline.com/doi/abs/10.1207/s15516709cogni0702_3
5. National Research Council. *How People Learn: Brain, Mind, Experience, and School*. National Academies Press. https://nap.nationalacademies.org/catalog/9853/how-people-learn-brain-mind-experience-and-school-expanded-edition
6. Chi, M. T. H., & Wylie, R. (2014). *The ICAP Framework*. Educational Psychologist. https://www.tandfonline.com/doi/full/10.1080/00461520.2014.965823
7. Kapur, M. (2008). *Productive Failure*. Cognition and Instruction. https://www.tandfonline.com/doi/full/10.1080/07370000802212669
8. Pashler, H., et al. (2008). *Learning Styles: Concepts and Evidence*. Psychological Science in the Public Interest. https://pubmed.ncbi.nlm.nih.gov/26162104/
