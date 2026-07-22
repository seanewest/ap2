import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { marked } from "marked";

const outputDirectory = "dist/gh-docs";
const markdown = await readFile("gh-docs/developer-bootstrap.md", "utf8");
const content = marked.parse(markdown, { async: false });
const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>After Party developer bootstrap</title>
    <style>
      body { max-width: 48rem; margin: 0 auto; padding: 2rem; font: 1rem/1.6 system-ui, sans-serif; }
      code, pre { font-family: ui-monospace, monospace; }
      pre { overflow-x: auto; padding: 1rem; background: #f3f4f6; }
      blockquote { margin-inline: 0; padding-left: 1rem; border-left: 0.25rem solid #b91c1c; }
    </style>
  </head>
  <body>${content}</body>
</html>
`;

await mkdir(outputDirectory, { recursive: true });
await Promise.all([
  writeFile(`${outputDirectory}/developer-bootstrap.html`, html),
  copyFile("gh-docs/developer-bootstrap.md", `${outputDirectory}/developer-bootstrap.md`),
  copyFile("gh-docs/create-entra-app.sh", `${outputDirectory}/create-entra-app.sh`),
  copyFile("gh-docs/delete-entra-app.sh", `${outputDirectory}/delete-entra-app.sh`),
]);
