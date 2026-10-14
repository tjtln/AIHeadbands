# TJs Headbands

This repository contains a TypeScript web app inspired by the mobile game Headbands. Pick a topic, and the app shows one word at a time on a full-screen game board with a countdown timer and quick settings controls.

## Structure

- `shared` — shared TypeScript types used by the frontend
- `frontend` — Vite React app with the game UI and the topic word lists
- `.github/workflows` — GitHub Actions deployment pipeline for AWS

## Topics

Word lists live in [`frontend/src/data/topics.json`](frontend/src/data/topics.json) as a single JSON object:

```json
{
  "Math": ["triangle", "circle", "equation", "..."],
  "Movies": ["actor", "scene", "director", "..."]
}
```

Add a new topic by adding a new top-level key with an array of words. Edit an existing topic by editing its array. No build step or schema beyond that — just valid JSON.

## Local development

1. Install dependencies:
   ```bash
   npm install
   ```
2. Build the shared package and app bundle:
   ```bash
   npm run build
   ```
3. Start the frontend dev server:
   ```bash
   npm run dev:frontend
   ```

## AWS deployment pattern

The app is a static frontend only — no backend, no AI API costs:

- Frontend is deployed with S3 + CloudFront by `frontend/template.yaml`
- GitHub Actions deploys the stack using repository secrets for AWS credentials

Repository secrets to configure:

- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
