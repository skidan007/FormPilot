import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../middleware/requireAuth.js";

export const submissionsRouter = Router({
  mergeParams: true,
});
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

submissionsRouter.use(requireAuth);


function escapeCsv(value: unknown): string {
  let text: string;

  if (value === null || value === undefined) {
    text = "";
  } else if (typeof value === "object") {
    text = JSON.stringify(value);
  } else {
    text = String(value);
  }

  // Prevent spreadsheet formula injection in untrusted text.
  if (/^[\t\n\r ]*[=+\-@]/.test(text)) {
    text = `'${text}`;
  }

  return `"${text.replace(/"/g, '""')}"`;
}



 // GET /api/forms/:formId/submissions/export
submissionsRouter.get("/export", async (req, res, next) => {
  try {
    const formId = (
      req.params as { formId?: string }
    ).formId;

    if (
      typeof formId !== "string" ||
      !uuidPattern.test(formId)
    ) {
      res.status(400).json({
        status: "error",
        message: "Invalid form ID.",
      });
      return;
    }

    const form = await prisma.form.findFirst({
      where: {
        id: formId,
        ownerId: req.session.userId!,
      },
      select: {
        id: true,
        title: true,
      },
    });

    if (!form) {
      res.status(404).json({
        status: "error",
        message: "Form not found.",
      });
      return;
    }

    const submissions = await prisma.submission.findMany({
      where: { formId },
      orderBy: { submittedAt: "asc" },
      include: {
        answers: true,
      },
    });

    // Build a union of questions from the saved form snapshots.
    // This preserves older questions if the form changes later.
    const questionLabels: string[] = [];
    const seenLabels = new Set<string>();

    for (const submission of submissions) {
      const snapshot = submission.formVersionSnapshot as {
        fields?: Array<{
          label?: string;
          position?: number;
        }>;
      };

      const snapshotFields = [...(snapshot.fields ?? [])]
        .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));

      for (const field of snapshotFields) {
        if (field.label && !seenLabels.has(field.label)) {
          seenLabels.add(field.label);
          questionLabels.push(field.label);
        }
      }

      for (const answer of submission.answers) {
        if (!seenLabels.has(answer.fieldLabel)) {
          seenLabels.add(answer.fieldLabel);
          questionLabels.push(answer.fieldLabel);
        }
      }
    }

    const headers = [
      "Submission ID",
      "Submitted At",
      ...questionLabels,
    ];

    const rows = submissions.map((submission) => {
      const answersByLabel = new Map<string, unknown>();

      for (const answer of submission.answers) {
        answersByLabel.set(answer.fieldLabel, answer.value);
      }

      return [
        submission.id,
        submission.submittedAt.toISOString(),
        ...questionLabels.map(
          (label) => answersByLabel.get(label) ?? ""
        ),
      ];
    });

    const csv = [
      headers.map(escapeCsv).join(","),
      ...rows.map((row) => row.map(escapeCsv).join(",")),
    ].join("\r\n");

    const filename = `formpilot-responses-${form.id}.csv`;

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${filename}"`
    );

    res.send("\uFEFF" + csv);
  } catch (error) {
    next(error);
  }
});


// GET /api/forms/:formId/submissions
submissionsRouter.get("/", async (req, res, next) => {
  try {
    const formId = (req.params as { formId?: string }).formId;

    if (typeof formId !== "string" || !uuidPattern.test(formId)) {
      res.status(400).json({
        status: "error",
        message: "Invalid form ID.",
      });
      return;
    }

    // Confirm the form belongs to the logged-in user.
    const form = await prisma.form.findFirst({
      where: {
        id: formId,
        ownerId: req.session.userId!,
      },
      select: {
        id: true,
        title: true,
        status: true,
      },
    });

    if (!form) {
      res.status(404).json({
        status: "error",
        message: "Form not found.",
      });
      return;
    }

    const submissions = await prisma.submission.findMany({
      where: { formId },
      orderBy: { submittedAt: "desc" },
      select: {
        id: true,
        submittedAt: true,
        _count: {
          select: { answers: true },
        },
      },
    });

    res.json({
      status: "ok",
      form,
      count: submissions.length,
      submissions,
    });
  } catch (error) {
    next(error);
  }
});


 // GET /api/forms/:formId/submissions/:submissionId
submissionsRouter.get("/:submissionId", async (req, res, next) => {
  try {
    const formId = (
      req.params as { formId?: string }
    ).formId;

    const submissionId = (
      req.params as { submissionId?: string }
    ).submissionId;

    if (
      typeof formId !== "string" ||
      !uuidPattern.test(formId) ||
      typeof submissionId !== "string" ||
      !uuidPattern.test(submissionId)
    ) {
      res.status(400).json({
        status: "error",
        message: "Invalid form or submission ID.",
      });
      return;
    }

    const submission = await prisma.submission.findFirst({
      where: {
        id: submissionId,
        formId,
        form: {
          ownerId: req.session.userId!,
        },
      },
      include: {
        answers: {
          orderBy: {
            fieldLabel: "asc",
          },
          select: {
            id: true,
            fieldId: true,
            fieldLabel: true,
            fieldType: true,
            value: true,
          },
        },
      },
    });

    if (!submission) {
      res.status(404).json({
        status: "error",
        message: "Submission not found.",
      });
      return;
    }

    res.json({
      status: "ok",
      submission,
    });
  } catch (error) {
    next(error);
  }
});

