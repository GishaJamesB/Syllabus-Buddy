# Syllabus Buddy — Student MVP Specification

> This is the starting idea for the project. The [README](../README.md) describes the app as it is now.

## 1. Overview
A child-safe web app built on **Firebase AI Logic** that turns a syllabus or study PDF—starting with NCERT *Ganita Prakash* Grade 6, Chapter 6 (*Perimeter and Area*) as a built-in sample and supporting other subjects in future like history or biology—into step-by-step lessons, hints, and unlimited timed tests for students.

## 2. Core Rules
* **Deterministic Math & Diagrams:** Math calculations, answer checks, and shape/diagram rendering run in deterministic code so numbers and labels always match—never guessed by AI.
* **Multi-Subject Syllabus Support:** Any uploaded PDF syllabus/chapter is structured into bite-sized ideas, examples, diagrams/visuals, and questions tailored to the subject.
* **Child Privacy:** No real names, emails, or logins. Students use a **nickname**, and all data stays locally on the device (`IndexedDB` / `localStorage`).
* **Private PDFs:** Uploaded syllabus/textbook PDFs are used privately and never shared. Only I can upload the pdf, not end users.

## 3. Hybrid AI Architecture (Firebase AI Logic)
* **On-Device (Gemini Nano via Firebase AI Logic, with cloud fallback):** Classifies student replies (`answer_attempt`, `needs_clue`, `review_previous`, `off_topic`), generates quick initial clues locally, and summarizes local mistake tags.
* **Cloud (Gemini via Firebase AI Logic + Function Calling):** Parses PDF syllabi into study modules, runs the bounded tutoring loop, and writes *"explain why"* corrections.
* **Deterministic Code:** Generates varied question parameters, grades numeric/math answers, draws labeled diagrams from exact numbers, and computes test timers.

## 4. Agentic Tutoring Loop
After each student answer, the **Tutoring Agent** inspects the grading result and attempt count (capped at `maxTurns = 5`) and calls client tools:
* `presentIdea(topicId)` — Teaches one idea at a time with a worked example.
* `showDiagram(spec)` — Displays a code-drawn labeled diagram (for geometry/math) or topic visual.
* `provideClue(attemptCount)` — Gives a clue on wrong answers, and full step-by-step working after repeated misses.
* `stepNavigation(action)` — Moves forward only on a right answer, while letting the student go back anytime.
* `suggestTimedTest(focusTopics)` — Suggests a 10-question timed test when ready.

## 5. Student Features
1. One-idea-at-a-time explanations with a worked example.
2. Check-for-understanding question after each idea.
3. Progressive clues on wrong answers, and full working after a few misses.
4. Advances only when answered right, while allowing going back anytime.
5. Diagrams showing shapes/concepts with matching labels.
6. Unlimited unique 10-question test papers on demand.
7. Test timer calibrated for a 12-year-old based on difficulty.
8. Automated marking and corrections, including *"explain why"* answers.
9. One sample 1-minute video with slides and computer voice.
10. Persistent local progress across visits under a nickname.
11. Child might have option that lesson will be explained to him using audio (check if possible / expensive)
