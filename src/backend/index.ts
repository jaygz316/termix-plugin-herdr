import type { Router } from "express";
import type { PluginContext } from "@termix-ssh/plugin-sdk/backend";
import { registerRoutes } from "./routes.js";

export async function activate(ctx: PluginContext) {
  registerRoutes(ctx.http.router<Router>(), ctx);
}

export async function deactivate() {
  // Routes and pooled SSH connections were made through ctx; core disposes them.
}
