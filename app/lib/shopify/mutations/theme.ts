export const THEME_FILES_UPSERT_MUTATION = `#graphql
  mutation duplifyThemeFilesUpsert($themeId: ID!, $files: [OnlineStoreThemeFilesUpsertFileInput!]!) {
    themeFilesUpsert(themeId: $themeId, files: $files) {
      upsertedThemeFiles { filename }
      userErrors { field message }
    }
  }
`;

export interface ThemeFileUpsertInput {
  filename: string;
  body: { type: "TEXT" | "BASE64" | "URL"; value: string };
}
