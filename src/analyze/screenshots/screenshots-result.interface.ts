export interface ScreenshotEntry {
  url: string;
  cloudinaryPublicId: string;
  takenAt: string;
}

export interface ScreenshotsAnalyzeResult {
  desktop: ScreenshotEntry | null;
  mobile: ScreenshotEntry | null;
}
