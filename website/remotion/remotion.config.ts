/**
 * Nested Remotion project for Pi Orbs site videos.
 * All configuration options: https://remotion.dev/docs/config
 *
 * Public files live in ../ (website/), so OffthreadVideo can read
 * pi-orbs-site-hero.mp4 without duplicating it. Scripts also pass
 * --public-dir .. so this works from website/remotion.
 */

import path from "node:path";
import { Config } from "@remotion/cli/config";

Config.setPublicDir(path.join(__dirname, ".."));
Config.setVideoImageFormat("jpeg");
Config.setOverwriteOutput(true);
Config.setPixelFormat("yuv420p");
