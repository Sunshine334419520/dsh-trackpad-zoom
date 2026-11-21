/**
 * Trackpad pinch zoom for the conversation and the Markdown preview.
 *
 * A macOS trackpad pinch arrives in Chromium as `wheel` with `ctrlKey` set, the
 * same event the document preview already uses for images and PDFs. This module
 * claims that gesture in two places and leaves everything else alone:
 *
 *  - the conversation transcript (but not the composer), and
 *  - a Markdown preview in the right column.
 *
 * Both get the browser's zoom model: the layout is scaled, it is not re-wrapped.
 * CSS `zoom` multiplies used lengths while a percentage width resolves against
 * the unzoomed containing block — scaling the type alone would turn three lines
 * into five. Each zoomed box therefore gets an explicit pixel width equal to the
 * width it had before scaling; `zoom` multiplies that width by the same factor
 * as the type, so every line keeps exactly the characters it had and the
 * transcript/preview reads as the same layout, magnified. Wider than the
 * viewport is what makes each surface a horizontally pannable canvas: the
 * scroller owns that scroll.
 *
 * The gesture is anchored at the pointer: the content under the fingers stays
 * under them while the factor changes, like browser zoom.
 *
 * 100% is the floor: the default rendering is the smallest size, the gesture
 * only enlarges. Deliberately invisible: no HUD, no control pill, no keyboard
 * shortcut. Each domain remembers its own factor in `localStorage`; pinching
 * back to 100% is the reset, and clearing the keys restores the default.
 *
 * Image and PDF previews keep their own pointer-anchored zoom: the hit test
 * lets those events through untouched.
 */
window.__ModuleLoader__.load({
  id: 'dsh-trackpad-zoom',
  factory() {
    /**
     * The default rendering is the floor: pinch never shrinks either surface
     * below the size DeepSeek Harness renders by itself.
     */
    const MIN = 1
    const MAX = 4
    /** Wheel delta → zoom exponent. Matches the document preview's feel. */
    const SENSITIVITY = 0.01
    /** One wheel event cannot change more than this before clamping. */
    const MAX_DELTA = 40
    /** Persist the settled factor instead of writing on every wheel event. */
    const SAVE_DELAY = 200
    const CHAT_KEY = 'dsh-trackpad-zoom:chat'
    const PREVIEW_KEY = 'dsh-trackpad-zoom:preview'
    /** The factor the former package name stored; read once, then ignored. */
    const LEGACY_CHAT_KEY = 'dsh-chat-zoom:factor'
    /** A gesture trace, so a report can be read back without DevTools. */
    const TRACE_KEY = 'dsh-trackpad-zoom:trace'
    /** A layout probe, so a report can explain what the factor did to the page. */
    const PROBE_KEY = 'dsh-trackpad-zoom:probe'
    const TRACE_LIMIT = 32
    /** The chat surface that owns the scroll position. */
    const SCROLLER = '[data-conversation-scroll]'
    /** The chat region; the gesture only counts inside it. */
    const CHAT = '[data-conversation-region="chat"]'
    /** The sticky composer seat: part of the scroller, but not of the transcript. */
    const COMPOSER = '[data-composer-seat]'
    /**
     * The right column, whether the preview tab sits in the sidebar itself or
     * in a docked/floating pane.
     */
    const PREVIEW = '[data-sidebar-right-panel], [data-dockkit-pane], [data-dockkit-float]'
    /** The only preview renderer this module scales. */
    const MARKDOWN = '[data-document-markdown]'
    /** Renderers that already implement their own pointer-anchored zoom. */
    const NATIVE_ZOOM = '[data-document-zoom-scrollport],[data-document-zoom-frame]'
    /** Marker on every box this module zoomed, for unload. */
    const ZOOMED = 'data-dsh-trackpad-zoom'
    /** Marker on the chat scroller that gained horizontal panning. */
    const PAN = 'data-dsh-trackpad-zoom-pan'
    /** Marker on the stylesheet element, for unload. */
    const STYLE = 'data-dsh-trackpad-zoom-style'

    /**
     * The chat view clips horizontal overflow on purpose ("never expose
     * horizontal scrollable overflow"), and the zoomed transcript needs exactly
     * that overflow back. Every clipping ancestor between the scroll container
     * and the flow stops clipping once the transcript is wider than the column,
     * so the scroll container itself owns the pan and the composer stays put.
     *
     * Markdown previews need none of this: their own body is already an
     * `overflow: auto` scrollport.
     */
    const CSS = `
[${PAN}]:not(:has([data-conversation-composer-overlay])) {
  overflow-x: auto;
  overscroll-behavior-x: contain;
}
[${PAN}] :has([data-chat-flow]) {
  overflow: visible;
}
[${PAN}] > ${COMPOSER} {
  position: sticky;
  left: 0;
}
`

    let chatZoom = load(CHAT_KEY, LEGACY_CHAT_KEY)
    let previewZoom = load(PREVIEW_KEY, null)
    let saveTimer = 0
    let disposed = false
    const trace = []
    const probe = { chat: 1, preview: 1, w: 0, pan: false, sc: null, md: null, boxes: [] }

    function clamp(value) {
      return Math.min(MAX, Math.max(MIN, value))
    }

    function load(key, fallback) {
      try {
        const stored = window.localStorage.getItem(key)
        const raw = stored === null && fallback !== null ? window.localStorage.getItem(fallback) : stored
        const parsed = raw === null ? Number.NaN : Number(raw)
        if (!Number.isFinite(parsed) || parsed <= 0) return 1
        return clamp(parsed)
      } catch {
        return 1
      }
    }

    function save() {
      try {
        window.localStorage.setItem(CHAT_KEY, String(chatZoom))
        window.localStorage.setItem(PREVIEW_KEY, String(previewZoom))
        if (trace.length > 0) window.localStorage.setItem(TRACE_KEY, JSON.stringify(trace))
        window.localStorage.setItem(PROBE_KEY, JSON.stringify(probe))
      } catch {}
    }

    function scheduleSave() {
      if (saveTimer) return
      saveTimer = window.setTimeout(() => {
        saveTimer = 0
        save()
      }, SAVE_DELAY)
    }

    function record(entry) {
      trace.push(entry)
      if (trace.length > TRACE_LIMIT) trace.splice(0, trace.length - TRACE_LIMIT)
    }

    function scrollers() {
      return Array.from(document.querySelectorAll(CHAT))
        .map((region) => region.querySelector(SCROLLER))
        .filter((scroller) => scroller !== null)
    }

    /**
     * Slot outlets are layout-transparent (`display: contents`), so the boxes
     * that actually wrap the transcript sit below the anchor. Walk down to the
     * first real boxes; a width set on a `contents` node would be ignored.
     */
    function boxesOf(node, out) {
      if (getComputedStyle(node).display === 'contents') {
        for (const child of node.children) boxesOf(child, out)
        return out
      }
      out.push(node)
      return out
    }

    /** The transcript boxes: every scroller child except the composer. */
    function surfaces(scroller) {
      const out = []
      for (const child of scroller.children) {
        if (child.matches(COMPOSER)) continue
        boxesOf(child, out)
      }
      return out
    }

    /** The nearest real ancestor box of `element` (slot anchors are `contents`). */
    function parentBox(element) {
      let node = element.parentElement
      while (node !== null && getComputedStyle(node).display === 'contents') node = node.parentElement
      return node
    }

    /**
     * The unwindowed width the element is laid out in: its containing block,
     * which is the parent's content box. Taking it from the parent keeps the
     * number right when a padded wrapper sits between the scroller and the box,
     * because the wrapping that must stay identical is laid out against the
     * wrapper, not against the scroller.
     */
    function availableWidth(element) {
      const box = parentBox(element)
      if (box === null) return 0
      const style = getComputedStyle(box)
      const padding = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0)
      return Math.max(0, box.clientWidth - padding)
    }

    /**
     * The preview body has no data attribute of its own: it is the nearest
     * ancestor that actually scrolls, which is exactly the box a pan needs.
     */
    function nearestScroller(element) {
      let node = element.parentElement
      while (node !== null && node !== document.documentElement) {
        const style = getComputedStyle(node)
        if (
          style.overflowY === 'auto' ||
          style.overflowY === 'scroll' ||
          style.overflowX === 'auto' ||
          style.overflowX === 'scroll'
        ) {
          return node
        }
        node = node.parentElement
      }
      return null
    }

    /** Every Markdown preview box the right column currently shows. */
    function previewSurfaces() {
      const out = []
      for (const panel of document.querySelectorAll(PREVIEW)) {
        for (const element of panel.querySelectorAll(MARKDOWN)) {
          const scroller = nearestScroller(element)
          if (scroller !== null) out.push({ element, scroller })
        }
      }
      return out
    }

    function applyTo(element, factor, width) {
      element.setAttribute(ZOOMED, '')
      const next = String(factor)
      if (element.style.zoom !== next) element.style.zoom = next
      // A pixel width equal to the unwindowed content width: `zoom` multiplies
      // both this width and the type by the same factor, so the box grows with
      // the text and lines break exactly where they did at 100%.
      const nextWidth = factor > 1 && width > 0 ? `${width}px` : ''
      if (element.style.width !== nextWidth) element.style.width = nextWidth
    }

    function describe(element) {
      const style = getComputedStyle(element)
      return {
        d: style.display,
        w: element.style.width,
        cw: element.clientWidth,
        sw: element.scrollWidth,
        fs: style.fontSize,
        ox: style.overflowX,
      }
    }

    let syncQueued = false
    /** Coalesce re-layout work: the transcript streams new nodes constantly. */
    function scheduleSync() {
      if (syncQueued) return
      syncQueued = true
      window.requestAnimationFrame(() => {
        syncQueued = false
        sync()
      })
    }

    function syncChat() {
      for (const scroller of scrollers()) {
        for (const surface of surfaces(scroller)) {
          const width = availableWidth(surface)
          applyTo(surface, chatZoom, width)
          if (probe.boxes.length < 3) probe.boxes.push(describe(surface))
          if (probe.w === 0) probe.w = width
        }
        // Anything above 100% is wider than the column by construction.
        if (chatZoom > 1) scroller.setAttribute(PAN, '')
        else scroller.removeAttribute(PAN)
        if (probe.sc === null) {
          probe.sc = {
            cw: scroller.clientWidth,
            sw: scroller.scrollWidth,
            sl: Math.round(scroller.scrollLeft),
            ox: getComputedStyle(scroller).overflowX,
            pan: scroller.hasAttribute(PAN),
          }
          probe.pan = scroller.hasAttribute(PAN)
        }
      }
    }

    function syncPreview() {
      for (const { element, scroller } of previewSurfaces()) {
        const width = availableWidth(element)
        if (probe.md === null) {
          probe.md = {
            w: width,
            cw: scroller.clientWidth,
            sw: scroller.scrollWidth,
            ox: getComputedStyle(scroller).overflowX,
          }
        }
        applyTo(element, previewZoom, width)
      }
    }

    /** Apply both factors to everything the host has mounted. */
    function sync() {
      if (disposed) return
      probe.chat = Math.round(chatZoom * 1000) / 1000
      probe.preview = Math.round(previewZoom * 1000) / 1000
      probe.boxes.length = 0
      probe.sc = null
      probe.md = null
      probe.w = 0
      syncChat()
      syncPreview()
    }

    /**
     * The content point under the pointer, in the scroll container's own
     * coordinates. A pinch grows the surface around the pointer the way a
     * browser does: whatever sits under the fingers stays under them.
     */
    function anchorOf(scroller, event) {
      if (!Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return null
      const rect = scroller.getBoundingClientRect()
      const x = event.clientX - rect.left
      const y = event.clientY - rect.top
      return { x, y, cx: scroller.scrollLeft + x, cy: scroller.scrollTop + y }
    }

    /**
     * Everything inside the zoomed surface scales by the factor, so the
     * anchored content point lands at the same distance from the pointer once
     * the scroll offsets follow it.
     */
    function applyAnchor(scroller, anchor, scale) {
      if (anchor === null) return
      scroller.scrollLeft = anchor.cx * scale - anchor.x
      scroller.scrollTop = anchor.cy * scale - anchor.y
    }

    /** The preview tab body that owns a node, if it is inside one. */
    function tabOf(element) {
      return element === null ? null : element.closest('[data-dockkit-tab], [data-sidebar-right-tab]')
    }

    /**
     * The Markdown preview a gesture belongs to: the one under the pointer, or
     * — when the pointer is over the preview's own padding — the one in the same
     * tab body, so a pinch anywhere on the preview works without reaching into
     * another tab.
     */
    function markdownOf(target) {
      const own = target.closest(MARKDOWN)
      if (own !== null) return own
      if (target.closest(PREVIEW) === null) return null
      const tab = tabOf(target)
      return tab === null ? null : tab.querySelector(MARKDOWN)
    }

    /**
     * Which surface the gesture is over: the chat transcript, the Markdown
     * preview, or nothing this module owns. `native` marks the previews that
     * implement their own zoom and must keep the gesture.
     */
    function targetOf(target) {
      if (target === null) return { native: false, domain: null, scroller: null }
      const native = target.closest(NATIVE_ZOOM) !== null
      const chatRegion = target.closest(CHAT)
      if (chatRegion !== null) {
        return { native, domain: 'chat', scroller: chatRegion.querySelector(SCROLLER) }
      }
      const markdown = markdownOf(target)
      if (markdown !== null) {
        return { native, domain: 'preview', scroller: nearestScroller(markdown) }
      }
      return { native, domain: null, scroller: null }
    }

    function onWheel(event) {
      if (disposed || !event.ctrlKey) return
      const target = event.target instanceof Element ? event.target : null
      const { native, domain, scroller } = targetOf(target)

      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 100 : 1
      const delta = Math.max(-MAX_DELTA, Math.min(MAX_DELTA, event.deltaY * unit))
      const factor = domain === 'chat' ? chatZoom : domain === 'preview' ? previewZoom : chatZoom

      record({
        t: Date.now(),
        v: domain,
        y: Math.round(event.deltaY * 100) / 100,
        m: event.deltaMode,
        d: Math.round(delta * 100) / 100,
        p: event.defaultPrevented,
        n: native,
        z: Math.round(factor * 1000) / 1000,
      })

      if (event.defaultPrevented || native || domain === null || scroller === null) {
        scheduleSave()
        return
      }
      if (!delta) {
        scheduleSave()
        return
      }

      // Claim the gesture: the page itself must not zoom underneath it.
      event.preventDefault()
      event.stopPropagation()

      const next = clamp(factor * Math.exp(-delta * SENSITIVITY))
      if (Math.abs(next - factor) >= 1e-4) {
        const anchor = anchorOf(scroller, event)
        const previous = factor
        if (domain === 'chat') chatZoom = next
        else previewZoom = next
        trace[trace.length - 1].a = Math.round(next * 1000) / 1000
        sync()
        applyAnchor(scroller, anchor, next / previous)
      }
      scheduleSave()
    }

    return {
      inject: [],
      apply(ctx) {
        if (typeof window === 'undefined' || typeof document === 'undefined') return

        const flush = () => {
          if (saveTimer) {
            window.clearTimeout(saveTimer)
            saveTimer = 0
          }
          save()
        }

        ctx.effect(() => {
          const style = document.createElement('style')
          style.setAttribute(STYLE, '')
          style.textContent = CSS
          document.head.append(style)

          sync()

          // A re-rendered or newly opened conversation mounts a fresh region,
          // a preview mounts its Markdown body, and a resized window changes
          // the width the factor multiplies.
          const observer = new MutationObserver((records) => {
            for (const record of records) {
              for (const node of record.addedNodes) {
                if (node.nodeType === 1) {
                  scheduleSync()
                  return
                }
              }
            }
          })
          observer.observe(document.body, { childList: true, subtree: true })

          const resizer = new ResizeObserver(() => scheduleSync())
          const observed = new Set()
          const observeScrollers = () => {
            const candidates = [...scrollers(), ...previewSurfaces().map((entry) => entry.scroller)]
            for (const candidate of candidates) {
              if (observed.has(candidate)) continue
              observed.add(candidate)
              resizer.observe(candidate)
            }
          }
          observeScrollers()

          const onResize = () => {
            observeScrollers()
            scheduleSync()
          }
          window.addEventListener('resize', onResize)

          window.addEventListener('wheel', onWheel, { capture: true, passive: false })
          window.addEventListener('pagehide', flush)
          window.addEventListener('beforeunload', flush)

          // Invisible diagnostic handle, so a report can distinguish "the
          // gesture never arrived" from "the gesture arrived but landed
          // nowhere". Not part of the plugin's user-facing surface.
          const handle = {
            get chat() {
              return chatZoom
            },
            get preview() {
              return previewZoom
            },
            get probe() {
              return JSON.parse(JSON.stringify(probe))
            },
            get trace() {
              return trace.slice()
            },
            setChat(value) {
              const next = Number(value)
              if (!Number.isFinite(next)) return chatZoom
              chatZoom = clamp(next)
              sync()
              save()
              return chatZoom
            },
            setPreview(value) {
              const next = Number(value)
              if (!Number.isFinite(next)) return previewZoom
              previewZoom = clamp(next)
              sync()
              save()
              return previewZoom
            },
            reset() {
              chatZoom = 1
              previewZoom = 1
              sync()
              save()
              return 1
            },
          }
          window.__dshTrackpadZoom = handle

          return () => {
            disposed = true
            observer.disconnect()
            resizer.disconnect()
            window.removeEventListener('resize', onResize)
            window.removeEventListener('wheel', onWheel, { capture: true })
            window.removeEventListener('pagehide', flush)
            window.removeEventListener('beforeunload', flush)
            if (window.__dshTrackpadZoom === handle) delete window.__dshTrackpadZoom
            if (saveTimer) {
              window.clearTimeout(saveTimer)
              saveTimer = 0
            }
            style.remove()
            for (const element of document.querySelectorAll(`[${ZOOMED}]`)) {
              element.style.removeProperty('zoom')
              element.style.removeProperty('width')
              element.removeAttribute(ZOOMED)
            }
            for (const element of document.querySelectorAll(`[${PAN}]`)) element.removeAttribute(PAN)
          }
        })
      },
    }
  },
})