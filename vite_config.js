import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// ★ ここをあなたのGitHubリポジトリ名に変更してください
//    例: リポジトリが https://github.com/yourname/shift-calendar なら "/shift-calendar/"
const REPO_NAME = "/shift-calendar/";

export default defineConfig({
  plugins: [react()],
  base: REPO_NAME,
});
