import db from "../../../db.server";
import { createAdminClient } from "../../shopify/admin-client";
import { MAIN_THEME_QUERY, THEMES_BY_NAME_QUERY, THEME_FILES_BY_ID_QUERY } from "../../shopify/queries/theme";
import { THEME_FILES_UPSERT_MUTATION, type ThemeFileUpsertInput } from "../../shopify/mutations/theme";
import { saveMapping } from "../idMapping.service";
import { isMigrationCancelled, logEvent } from "../migrationJob.service";
import type { ThemeFileBulkPayload } from "../types";
import type { MigrationJobWithConnection } from "../orchestrator.service";

// Shopify's Admin API has no "clone this store's theme onto another store"
// primitive — themeCreate only accepts a hosted zip URL, which this app
// doesn't produce. So this migrates *file contents* (templates, sections,
// config, locales) onto an already-existing destination theme of the same
// name, rather than fabricating a full theme package. It's a real, working
// capability, just a narrower one than "one-click clone a theme" — the merchant
// must first create a same-named (unpublished) theme on the destination store.
//
// Paid/marketplace themes carry their own licenses — copying their code to a
// second store the merchant hasn't licensed it on may violate that license.
// This is surfaced as a banner in the UI (see app.migrations.$id.scan.tsx)
// and is why this only runs when the merchant has explicitly selected Theme
// in a Custom migration.

interface ThemeFilesNode {
  id: string;
  name: string;
  files: {
    edges: Array<{
      node: {
        filename: string;
        body: { content?: string; contentBase64?: string; url?: string } | null;
      };
    }>;
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
}
interface MainThemeResponse {
  themes: { edges: Array<{ node: ThemeFilesNode }> };
}
interface ThemeByIdResponse {
  node: ThemeFilesNode | null;
}

export async function ensureThemeItems(job: MigrationJobWithConnection): Promise<void> {
  const existing = await db.migrationItem.count({ where: { migrationJobId: job.id, resourceType: "theme" } });
  if (existing > 0) return;

  await logEvent(job.id, "WARN", "Theme migration copies file contents only, onto an existing same-named destination theme — see Documentation for details and licensing considerations");

  const sourceAdmin = createAdminClient(job.storeConnection.sourceShop);
  // Merchant can pick a specific source theme in the New Migration form
  // instead of always exporting the live/MAIN one — stashed in
  // conflictStrategy since MigrationJob has no dedicated column for it.
  const chosenThemeId = (job.conflictStrategy as Record<string, unknown>).__themeSourceId as string | undefined;

  let after: string | null = null;
  let themeId: string | null = null;
  let themeName = "";
  const files: ThemeFileBulkPayload[] = [];

  do {
    let theme: ThemeFilesNode | undefined;
    if (chosenThemeId) {
      const result: ThemeByIdResponse = await sourceAdmin.graphql<ThemeByIdResponse>(THEME_FILES_BY_ID_QUERY, { id: chosenThemeId, after }, 20);
      theme = result.node ?? undefined;
    } else {
      const result: MainThemeResponse = await sourceAdmin.graphql<MainThemeResponse>(MAIN_THEME_QUERY, { after }, 20);
      theme = result.themes.edges[0]?.node;
    }

    if (!theme) {
      await logEvent(job.id, "INFO", "Source theme not found (it may have been deleted since the migration was created)");
      return;
    }
    themeId = theme.id;
    themeName = theme.name;
    for (const edge of theme.files.edges) {
      const body = toThemeFilePayload(edge.node.filename, edge.node.body);
      if (body) {
        files.push(body);
      }
    }
    after = theme.files.pageInfo.hasNextPage ? theme.files.pageInfo.endCursor : null;
  } while (after);

  await db.migrationItem.create({
    data: {
      migrationJobId: job.id,
      resourceType: "theme",
      stage: "theme",
      sourceId: themeId!,
      status: "PENDING",
      payload: { themeName, files } as unknown as object,
    },
  });
  await logEvent(job.id, "INFO", `Found theme "${themeName}" with ${files.length} files to migrate`);
}

interface ThemesByNameResponse {
  themes: { edges: Array<{ node: { id: string; name: string; role: string } }> };
}
interface ThemeFilesUpsertResponse {
  themeFilesUpsert: { upsertedThemeFiles: Array<{ filename: string }>; userErrors: Array<{ field: string[]; message: string }> };
}

const BATCH_SIZE = 20;

export async function runThemeStage(job: MigrationJobWithConnection): Promise<void> {
  await ensureThemeItems(job);

  const destAdmin = createAdminClient(job.storeConnection.destinationShop);
  const pendingItems = await db.migrationItem.findMany({
    where: { migrationJobId: job.id, resourceType: "theme", status: { in: ["PENDING", "RETRYING"] } },
  });

  for (const item of pendingItems) {
    if (await isMigrationCancelled(job.id)) return;
    const { themeName, files } = item.payload as unknown as { themeName: string; files: ThemeFileBulkPayload[] };

    await db.migrationItem.update({ where: { id: item.id }, data: { status: "PROCESSING", attempt: item.attempt + 1 } });

    let destinationThemeId: string | null = null;
    try {
      const themesResult = await destAdmin.graphql<ThemesByNameResponse>(THEMES_BY_NAME_QUERY, undefined, 10);
      destinationThemeId = themesResult.themes.edges.find((e) => e.node.name === themeName && e.node.role !== "MAIN")?.node.id ?? null;
    } catch (error) {
      await fail(job.id, item.id, errMsg(error));
      continue;
    }

    if (!destinationThemeId) {
      await db.migrationItem.update({
        where: { id: item.id },
        data: {
          status: "SKIPPED",
          errorMessage: `No unpublished theme named "${themeName}" found on the destination store. Create one (Online Store > Themes > Add theme), name it exactly "${themeName}", then retry.`,
        },
      });
      continue;
    }

    let failedBatch = false;
    for (let i = 0; i < files.length; i += BATCH_SIZE) {
      if (await isMigrationCancelled(job.id)) {
        await db.migrationItem.update({
          where: { id: item.id },
          data: { status: item.status, attempt: item.attempt },
        });
        return;
      }
      const batch = files.slice(i, i + BATCH_SIZE);
      const input: ThemeFileUpsertInput[] = batch.map((f) => ({
        filename: f.filename,
        body: { type: f.bodyType, value: f.value },
      }));

      try {
        const result = await destAdmin.graphql<ThemeFilesUpsertResponse>(
          THEME_FILES_UPSERT_MUTATION,
          { themeId: destinationThemeId, files: input },
          Math.ceil(batch.length / 2) + 5,
        );
        if (result.themeFilesUpsert.userErrors.length > 0) {
          const message = result.themeFilesUpsert.userErrors.map((e) => e.message).join("; ");
          await logEvent(job.id, "WARN", `Some theme files failed in batch ${i / BATCH_SIZE + 1}: ${message}`);
          failedBatch = true;
        }
      } catch (error) {
        await logEvent(job.id, "ERROR", `Theme file batch ${i / BATCH_SIZE + 1} failed: ${errMsg(error)}`);
        failedBatch = true;
      }
    }

    await saveMapping({ storeConnectionId: job.storeConnectionId, resourceType: "theme", sourceId: item.sourceId, destinationId: destinationThemeId });
    await db.migrationItem.update({
      where: { id: item.id },
      data: {
        status: failedBatch ? "FAILED" : "COMPLETED",
        destinationId: destinationThemeId,
        errorMessage: failedBatch ? "Some theme files failed to upload — see logs" : null,
      },
    });
    await logEvent(job.id, "INFO", `Migrated theme "${themeName}" (${files.length} files)`, { sourceId: item.sourceId });
  }
}

async function fail(migrationJobId: string, itemId: string, message: string): Promise<void> {
  await db.migrationItem.update({ where: { id: itemId }, data: { status: "FAILED", errorMessage: message } });
  await logEvent(migrationJobId, "ERROR", message, { itemId });
}
function errMsg(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function toThemeFilePayload(
  filename: string,
  body: { content?: string; contentBase64?: string; url?: string } | null,
): ThemeFileBulkPayload | null {
  if (!body) return null;
  if (body.content !== undefined) {
    return { filename, bodyType: "TEXT", value: body.content };
  }
  if (body.contentBase64 !== undefined) {
    return { filename, bodyType: "BASE64", value: body.contentBase64 };
  }
  if (body.url !== undefined) {
    return { filename, bodyType: "URL", value: body.url };
  }
  return null;
}
