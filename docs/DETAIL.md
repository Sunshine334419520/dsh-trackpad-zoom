# Trackpad zoom

Pinch on the trackpad to zoom the conversation column and Markdown previews the
way a browser zooms a page. The layout is magnified, not re-wrapped: three lines
stay three lines, and the surface grows wider so you can pan sideways.

**Use it:** put two fingers on the trackpad over the conversation, or over a
Markdown preview in the right column, and pinch. Chromium delivers that gesture
as `Ctrl` + wheel, which is exactly what this plugin listens for. Pinch out to
enlarge, pinch in to shrink. The range is 100% to 400%: the default rendering is
the smallest size, so the gesture only ever enlarges.

**Anchored at the pointer.** The content under the fingers stays under them while
the factor changes, so zooming behaves like browser/Edge zoom rather than growing
from the top-left corner.

**Panning.** Above 100% the zoomed surface is wider than its viewport: the
conversation or the preview body scrolls horizontally to reach the rest of the
line. On the conversation the composer stays pinned to the left edge and keeps
its own size.

**Nothing to hunt for in the UI.** There is no HUD, no control pill and no
keyboard shortcut: like the browser, the gesture itself is the whole interface.

**Remembered per surface.** The conversation factor is stored in `localStorage`
under `dsh-trackpad-zoom:chat` and Markdown previews under
`dsh-trackpad-zoom:preview`, so each survives a reload and a session switch
independently. Pinch back to 100% to reset one of them, or clear its key in
DevTools. A conversation factor saved by the former `dsh-chat-zoom` package is
picked up once on first load.

**What stays untouched:** image and PDF previews, which implement their own
pointer-anchored zoom and keep the gesture; HTML previews, which are iframes and
out of scope; the composer's own size; the window chrome and the page itself.

**Known limits:** zoom keeps the original line breaks, so above 100% the zoomed
box is wider than its viewport and is panned horizontally; a conversation pinned
to the newest message stays pinned, while a scrolled-up reading position keeps
the content under the pointer rather than a pixel-exact bookmark.
