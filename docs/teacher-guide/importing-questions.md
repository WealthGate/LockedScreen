# Importing Questions

LOCKEDSCREEN imports multiple-choice questions from existing exam documents and structured text. The parser is deterministic and uses document patterns rather than AI generation. If a file is partially recognized, the import review should still let the teacher correct the metadata, clean up extracted text, and select the correct option for each question before saving.

## Supported Files

- `.doc`
- `.docx`
- `.pdf`
- `.txt`

Legacy `.doc` import is best-effort on Windows and may depend on Microsoft Word being available on the device. If that path fails, convert the file to `.docx` or `.pdf` first.

## Supported Formats

### 1. Tagged Format

This is the most reliable format for bulk imports.

```text
[QUESTION]
What is the chemical symbol for sodium?
[OPTION]
A. S
[OPTION]
B. Na
[OPTION]
C. So
[OPTION]
D. Sd
[ANSWER]
B
[/QUESTION]
```

Rules:

- Each question starts with `[QUESTION]` and ends with `[/QUESTION]`.
- Every answer choice starts with its own `[OPTION]` marker.
- The correct answer appears after `[ANSWER]`.
- The answer value must match one option key such as `A`, `B`, `C`, or `D`.

### 2. Classic MCQ Format

This format is easier to type in plain text editors.

```text
Q1. What is the chemical symbol for sodium?
A. S
B. Na
C. So
D. Sd
ANS: B
```

Rules:

- A question line must start with `Q`, followed by a number and a period.
- Option lines must start with `A.`, `B.`, `C.`, and so on.
- The answer line must start with `ANS:`.
- The answer value must match one listed option key.

## Parser Recognition Rules

The parser should:

- detect heading or title text
- detect subject, class, form, and time fields when clearly labeled
- detect question boundaries
- collect the prompt text
- collect ordered options
- preserve detected answer keys when present
- report incomplete or malformed questions

The parser should reject or flag:

- questions with fewer than two options
- answer keys that do not match an option
- duplicate option keys within one question
- question blocks that never close in tagged format
- documents where the heading or metadata could not be detected reliably

## Formatting Guidance for Teachers

- Keep one answer option per line.
- Use plain option keys such as `A`, `B`, `C`, `D`.
- Do not add explanations on the `ANS:` line.
- Keep question numbering unique in classic format.
- For math and science content, use plain text or LaTeX-compatible notation that the app can render later.

Examples:

```text
Q2. Simplify \sqrt{49}.
A. 6
B. 7
C. 8
D. 9
ANS: B
```

```text
[QUESTION]
Which ion is written correctly for sulfate?
[OPTION]
A. SO_3^{2-}
[OPTION]
B. SO_4^{2-}
[OPTION]
C. SO_4^{-}
[OPTION]
D. S_4O^{2-}
[ANSWER]
B
[/QUESTION]
```

## Import Workflow

1. Prepare a `.doc`, `.docx`, `.pdf`, or `.txt` exam file.
2. Open the teacher dashboard and choose `Import Questions`.
3. Upload the file.
4. Review the extracted heading, subject, class, form, and time.
5. Review each imported question and option.
6. Select the correct option for every question.
7. Fix any flagged issues in the correction UI.
8. Save the cleaned question set into a new or existing exam.

## Sample Files

Sample templates are included here:

- [Structured tagged sample](../templates/sample-exam-structured.txt)
- [Classic text sample](../templates/sample-exam-classic.txt)
- [Doc-friendly authoring template](../templates/doc-friendly-question-template.txt)
