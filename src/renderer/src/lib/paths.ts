/**
 * Convert an absolute on-disk path into a URL the renderer can use
 * with `<video src>` / `<img src>` etc.
 *
 * Renderer pages are served from http://localhost (dev) or file://
 * (prod), neither of which can read arbitrary `file://` URLs under
 * Chromium's `webSecurity: true`. We route everything through the
 * `local-media://` custom protocol registered in the main process.
 *
 * The path goes into a query parameter rather than the URL path so
 * Chromium's standard-URL canonicalizer can't touch it. (Drive-letter
 * colons and backslashes in the path component otherwise get
 * normalized in surprising ways for "special" custom schemes.)
 *
 * Examples:
 *   "C:\\Users\\username\\My Ride.mp4"
 *     → "local-media://media/?p=C%3A%5CUsers%5Cusername%5CMy%20Ride.mp4"
 *   "/Users/username/My Ride.mp4"
 *     → "local-media://media/?p=%2FUsers%2Fusername%2FMy%20Ride.mp4"
 */
export function localMediaUrl(absolutePath: string): string {
  return `local-media://media/?p=${encodeURIComponent(absolutePath)}`;
}
