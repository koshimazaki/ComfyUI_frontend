import {
  draggable,
  dropTargetForElements
} from '@atlaskit/pragmatic-drag-and-drop/element/adapter'
import type { Directive } from 'vue'

import { useInputGroupStore } from '@/stores/inputGroupStore'
import { isWidgetId } from '@/types/widgetId'
import type { WidgetId } from '@/types/widgetId'

export function getEdgeTriZone(
  el: HTMLElement,
  clientY: number
): 'before' | 'center' | 'after' {
  const rect = el.getBoundingClientRect()
  const third = rect.height / 3
  if (clientY < rect.top + third) return 'before'
  if (clientY > rect.top + third * 2) return 'after'
  return 'center'
}

export function getDragItemKey(
  data: Record<string | symbol, unknown>
): WidgetId | null {
  if (data.type === 'group-item' && isWidgetId(data.itemKey))
    return data.itemKey
  return null
}

function clearIndicator(el: HTMLElement) {
  el.classList.remove('reorder-before', 'reorder-after', 'pair-indicator')
}

function setIndicator(el: HTMLElement, edge: 'before' | 'center' | 'after') {
  clearIndicator(el)
  if (edge === 'center') el.classList.add('pair-indicator')
  else el.classList.add(`reorder-${edge}`)
}

interface ItemReorderBinding {
  itemKey: WidgetId
  groupId: string
}

const reorderStates = new WeakMap<
  HTMLElement,
  { value: ItemReorderBinding; cleanup?: () => void }
>()

export const vGroupItemReorder: Directive<HTMLElement, ItemReorderBinding> = {
  mounted(el, { value }) {
    const state: { value: ItemReorderBinding; cleanup?: () => void } = { value }
    const store = useInputGroupStore()

    state.cleanup = dropTargetForElements({
      element: el,
      canDrop: ({ source }) => {
        const dragKey = getDragItemKey(source.data)
        return !!dragKey && dragKey !== state.value.itemKey
      },
      onDrag: ({ location }) => {
        setIndicator(el, getEdgeTriZone(el, location.current.input.clientY))
      },
      onDragEnter: ({ location }) => {
        setIndicator(el, getEdgeTriZone(el, location.current.input.clientY))
      },
      onDragLeave: () => clearIndicator(el),
      onDrop: ({ source, location }) => {
        clearIndicator(el)
        const dragKey = getDragItemKey(source.data)
        if (!dragKey) return

        const { groupId, itemKey } = state.value
        const edge = getEdgeTriZone(el, location.current.input.clientY)
        const sameGroup = !!store
          .findGroup(groupId)
          ?.items.some((i) => i.key === dragKey)

        if (!sameGroup) {
          store.moveItemToGroupAt(groupId, dragKey, itemKey, edge)
          return
        }

        if (edge === 'center') {
          const targetItem = store
            .findGroup(groupId)
            ?.items.find((i) => i.key === itemKey)
          if (targetItem?.pairId) {
            store.replaceInPair(groupId, itemKey, dragKey)
          } else {
            store.pairItemsInGroup(groupId, itemKey, dragKey)
          }
        } else {
          store.reorderWithinGroup(groupId, dragKey, itemKey, edge)
        }
      }
    })
    reorderStates.set(el, state)
  },
  updated(el, { value }) {
    const state = reorderStates.get(el)
    if (state) state.value = value
  },
  unmounted(el) {
    reorderStates.get(el)?.cleanup?.()
    reorderStates.delete(el)
  }
}

interface ItemDragBinding {
  itemKey: WidgetId
  groupId: string
}

const dragStates = new WeakMap<
  HTMLElement,
  { value: ItemDragBinding; cleanup?: () => void }
>()

export const vGroupItemDrag: Directive<HTMLElement, ItemDragBinding> = {
  mounted(el, { value }) {
    const state: { value: ItemDragBinding; cleanup?: () => void } = { value }
    state.cleanup = draggable({
      element: el,
      dragHandle: el.querySelector('.drag-handle') ?? undefined,
      getInitialData: () => ({
        type: 'group-item',
        itemKey: state.value.itemKey,
        sourceGroupId: state.value.groupId
      })
    })
    dragStates.set(el, state)
  },
  updated(el, { value }) {
    const state = dragStates.get(el)
    if (state) state.value = value
  },
  unmounted(el) {
    dragStates.get(el)?.cleanup?.()
    dragStates.delete(el)
  }
}

interface GroupDropBinding {
  groupId: string
}

const groupDropStates = new WeakMap<
  HTMLElement,
  { value: GroupDropBinding; cleanup?: () => void }
>()

const GROUP_DROP_ATTR = 'data-group-drop-id'

function findGroupDropUnderPointer(
  x: number,
  y: number
): { el: HTMLElement; groupId: string } | null {
  for (const el of document.elementsFromPoint(x, y)) {
    const groupId = el.getAttribute(GROUP_DROP_ATTR)
    if (groupId && el instanceof HTMLElement) return { el, groupId }
  }
  return null
}

let pendingDrag: { key: WidgetId; startX: number; startY: number } | null = null
let bridgeRefCount = 0
let removeBridge: (() => void) | null = null

function setupListToGroupBridge() {
  function onMouseDown(e: MouseEvent) {
    pendingDrag = null
    if (e.button !== 0 || !(e.target instanceof HTMLElement)) return
    const element = e.target.closest('.draggable-item.is-draggable')
    if (!(element instanceof HTMLElement)) return
    const itemKey = element.dataset.widgetKey
    if (isWidgetId(itemKey)) {
      pendingDrag = { key: itemKey, startX: e.clientX, startY: e.clientY }
    }
  }
  function cancelDrag() {
    pendingDrag = null
  }
  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') cancelDrag()
  }
  function onMouseUp(e: MouseEvent) {
    const drag = pendingDrag
    pendingDrag = null
    if (
      !drag ||
      Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < 5
    )
      return

    const target = findGroupDropUnderPointer(e.clientX, e.clientY)
    if (!target) return

    const store = useInputGroupStore()
    const group = store.findGroup(target.groupId)
    if (group?.items.some((i) => i.key === drag.key)) return

    store.addItemToGroup(target.groupId, drag.key)
  }
  document.addEventListener('mousedown', onMouseDown)
  document.addEventListener('mouseup', onMouseUp)
  document.addEventListener('pointercancel', cancelDrag)
  document.addEventListener('keydown', onKeyDown)
  removeBridge = () => {
    document.removeEventListener('mousedown', onMouseDown)
    document.removeEventListener('mouseup', onMouseUp)
    document.removeEventListener('pointercancel', cancelDrag)
    document.removeEventListener('keydown', onKeyDown)
  }
}

export const vGroupDropTarget: Directive<HTMLElement, GroupDropBinding> = {
  mounted(el, { value }) {
    const state: { value: GroupDropBinding; cleanup?: () => void } = { value }
    const store = useInputGroupStore()

    el.setAttribute(GROUP_DROP_ATTR, value.groupId)

    bridgeRefCount++
    if (bridgeRefCount === 1) setupListToGroupBridge()

    state.cleanup = dropTargetForElements({
      element: el,
      canDrop: ({ source }) => {
        const itemKey = getDragItemKey(source.data)
        if (!itemKey) return false
        return !!store.findGroup(state.value.groupId)
      },
      onDragEnter: () => el.classList.add('group-drag-over'),
      onDragLeave: () => el.classList.remove('group-drag-over'),
      onDrop: ({ source, location }) => {
        el.classList.remove('group-drag-over')
        if (location.current.dropTargets[0]?.element !== el) return
        const itemKey = getDragItemKey(source.data)
        if (!itemKey) return
        store.addItemToGroup(state.value.groupId, itemKey)
      }
    })
    groupDropStates.set(el, state)
  },
  updated(el, { value }) {
    const state = groupDropStates.get(el)
    if (state) state.value = value
    el.setAttribute(GROUP_DROP_ATTR, value.groupId)
  },
  unmounted(el) {
    groupDropStates.get(el)?.cleanup?.()
    groupDropStates.delete(el)
    el.removeAttribute(GROUP_DROP_ATTR)
    bridgeRefCount--
    if (bridgeRefCount === 0) {
      removeBridge?.()
      removeBridge = null
      pendingDrag = null
    }
  }
}

const ungroupDropStates = new WeakMap<
  HTMLElement,
  { value: boolean; cleanup?: () => void }
>()

export const vGroupUngroupTarget: Directive<HTMLElement, boolean> = {
  mounted(el, { value }) {
    const state: { value: boolean; cleanup?: () => void } = { value }
    const store = useInputGroupStore()
    state.cleanup = dropTargetForElements({
      element: el,
      canDrop: ({ source }) =>
        state.value && getDragItemKey(source.data) !== null,
      onDrop: ({ source, location }) => {
        if (location.current.dropTargets[0]?.element !== el) return
        const key = getDragItemKey(source.data)
        const groupId = source.data.sourceGroupId
        if (key && typeof groupId === 'string')
          store.removeItemFromGroup(groupId, key)
      }
    })
    ungroupDropStates.set(el, state)
  },
  updated(el, { value }) {
    const state = ungroupDropStates.get(el)
    if (state) state.value = value
  },
  unmounted(el) {
    ungroupDropStates.get(el)?.cleanup?.()
    ungroupDropStates.delete(el)
  }
}
