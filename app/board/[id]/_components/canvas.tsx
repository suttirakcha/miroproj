"use client"

import Info from "./info"
import Participants from "./participants"
import { useHistory, useCanRedo, useCanUndo, useMutation, useStorage, useOthersMapped, useSelf } from "@/liveblocks.config"
import { Toolbar } from "./toolbar"
import { useCallback, useMemo, useState } from "react"
import { CanvasState, CanvasMode, Camera, Color, LayerType, Point, Side, XYWH } from "@/types/canvas"
import { CursorsPresence } from "./cursors-presence"
import { colorToCss, connectionIdToColor, penToPath, pointerToCanvas, resizeBounds } from "@/lib/utils"
import { nanoid } from "nanoid"
import { LiveObject } from "@liveblocks/client"
import { LayerPreview } from "./layer-preview"
import { SelectionBox } from "./layertypes/selection-box"
import { SelectionTools } from "./layertypes/selection-tools"
import { Path } from "./layertypes/path"

interface CanvasProps {
  boardId: string
}

const MAX_LAYERS = 100

const Canvas = ({ boardId } : CanvasProps) => {

  const layerIds = useStorage((root) => root.layerIds)
  const history = useHistory()
  const canUndo = useCanUndo()
  const canRedo = useCanRedo()

  const pencilDraft = useSelf((me) => me.presence.pencilDraft)
  const [camera, setCamera] = useState<Camera>({ x: 0, y: 0 })
  const [lastUsedColor, setLastUsedColor] = useState<Color>({
    r: 0, g: 0, b: 0
  })

  const insertPath = useMutation(({ storage, self, setMyPresence }) => {
    const liveLayers = storage.get("layers")
    const { pencilDraft } = self.presence

    if (pencilDraft == null || pencilDraft.length < 2 || liveLayers.size >= MAX_LAYERS){
      setMyPresence({ pencilDraft: null })
      return
    }

    const id = nanoid()
    liveLayers.set(id, new LiveObject(penToPath(pencilDraft, lastUsedColor)))

    const liveLayerIds = storage.get("layerIds")
    liveLayerIds.push(id)

    setMyPresence({ pencilDraft: null })
    setCanvasState({ mode: CanvasMode.Pencil })
  }, [lastUsedColor])

  const insertLayer = useMutation((
    { storage, setMyPresence }, 
    layerType: LayerType.Ellipse | LayerType.Rectangle | LayerType.Text,
    position: Point
  ) => {
    const liveLayers = storage.get("layers")

    if (liveLayers.size >= MAX_LAYERS){
      return
    }

    const liveLayerIds = storage.get("layerIds")
    const layerId = nanoid()
    const layer = new LiveObject({
      type: layerType,
      x: position.x,
      y: position.y,
      height: 100,
      width: 100,
      fill: lastUsedColor
    })

    liveLayerIds.push(layerId)
    liveLayers.set(layerId, layer)

    setMyPresence({ selection: [layerId]}, { addToHistory: true })
    setCanvasState({ mode: CanvasMode.None })
  }, [lastUsedColor])

  const [canvasState, setCanvasState] = useState<CanvasState>({
    mode: CanvasMode.None
  })

  const unselectLayers = useMutation(({ self, setMyPresence } ) => {
    if (self.presence.selection.length > 0){
      setMyPresence({ selection:[] }, { addToHistory: true })
    }
  }, [])

  const startDrawing = useMutation(({ setMyPresence }, point: Point, pressure: number) => {
    setMyPresence({
      pencilDraft: [[point.x, point.y, pressure]],
      penColor: lastUsedColor
    })
  }, [lastUsedColor])

  const continueDrawing = useMutation(({ self, setMyPresence }, point: Point, e: React.PointerEvent) => {
    const { pencilDraft } = self.presence

    if (canvasState.mode !== CanvasMode.Pencil || e.buttons !== 1 || pencilDraft == null){
      return
    }

    setMyPresence({
      cursor: point,
      pencilDraft: pencilDraft.length === 1 && pencilDraft[0][0] === point.x && pencilDraft[0][1] === point.y ? pencilDraft : [...pencilDraft, [point.x, point.y, e.pressure]]
    })
  }, [canvasState.mode])

  const onWheel = useCallback((e: React.WheelEvent) => {
    setCamera((camera) => ({
      x: camera.x - e.deltaX,
      y: camera.y - e.deltaY,
    }))
  }, [])

  const resizeSelectedLayer = useMutation(({ storage, self }, point: Point) => {
    if (canvasState.mode !== CanvasMode.Resizing) return

    const bounds = resizeBounds(canvasState.initialBounds, canvasState.corner, point)
    const liveLayers = storage.get("layers")
    const layer = liveLayers.get(self.presence.selection[0])

    if (layer){ layer.update(bounds) }
  }, [canvasState])

  const translateSelectedLayer = useMutation(({ storage, self }, point: Point) => {
    if (canvasState.mode !== CanvasMode.Translating) return

    const offset = {
      x: point.x - canvasState.current.x,
      y: point.y - canvasState.current.y
    }

    const liveLayers = storage.get("layers")
    
    for (const id of self.presence.selection){
      const layer = liveLayers.get(id)

      if (layer){
        layer.update({
          x: layer.get("x") + offset.x,
          y: layer.get("y") + offset.y
        })
      }
    }

    setCanvasState({ mode: CanvasMode.Translating, current: point })
  }, [canvasState])

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    const point = pointerToCanvas(e, camera)

    if (canvasState.mode === CanvasMode.Inserting){ return }
    if (canvasState.mode === CanvasMode.Pencil){
      startDrawing(point, e.pressure)
      return
    }

    setCanvasState({ mode: CanvasMode.Pressing, origin: point })
  }, [camera, canvasState.mode, setCanvasState])

  const onPointerUp = useMutation(({}, e) => {
    const point = pointerToCanvas(e, camera)
    if (canvasState.mode === CanvasMode.None || canvasState.mode === CanvasMode.Pressing){ 
      unselectLayers()
    } else if (canvasState.mode === CanvasMode.Inserting){
      insertLayer(canvasState.layerType, point)
    } else if (canvasState.mode === CanvasMode.Pencil){
      insertPath()
    } else {
      setCanvasState({ mode: CanvasMode.None })
    }

    history.resume()
  }, [camera, canvasState, history, insertLayer, unselectLayers, insertPath])

  const onPointerMove = useMutation(({ setMyPresence }, e:React.PointerEvent ) => {
    e.preventDefault()

    const current = pointerToCanvas(e, camera)

    if (canvasState.mode === CanvasMode.Resizing){
      resizeSelectedLayer(current)
    } else if (canvasState.mode === CanvasMode.Translating){
      translateSelectedLayer(current)
    } else if (canvasState.mode === CanvasMode.Pencil){
      continueDrawing(current, e)
    }

    setMyPresence({ cursor: current })
  }, [canvasState, resizeSelectedLayer, camera, translateSelectedLayer])

  const onPointerLeave = useMutation(({ setMyPresence }) => {
    setMyPresence({ cursor: null })
  }, [])

  const selections = useOthersMapped((other) => other.presence.selection)

  const onLayerPointerDown = useMutation(({ self, setMyPresence }, e: React.PointerEvent, layerId: string) => {
    if (canvasState.mode === CanvasMode.Pencil || canvasState.mode === CanvasMode.Inserting){
      return;
    }

    history.pause()
    e.stopPropagation()

    const point = pointerToCanvas(e, camera)

    if (!self.presence.selection.includes(layerId)){
      setMyPresence({ selection: [layerId]}, {addToHistory: true})
    }

    setCanvasState({ mode: CanvasMode.Translating, current: point })
  }, [setCanvasState, camera, history, canvasState.mode])

  const onResizeHandlePointDown = useCallback((corner: Side, initialBounds: XYWH) => {
    history.pause()

    setCanvasState({
      mode: CanvasMode.Resizing,
      initialBounds,
      corner
    })
  }, [])

  const layerIdsToColorSelection = useMemo(() => {
    const layerIdsToColorSelection: Record<string, string> = {}

    for (const user of selections){
      const [connectionId, selection] = user

      for (const layerId of selection){
        layerIdsToColorSelection[layerId] = connectionIdToColor(connectionId)
      }
    }

    return layerIdsToColorSelection
  }, [selections])

  return (
    <main className="h-full w-full relative bg-gray-100 touch-none">
      <Info boardId={boardId}/>
      <Participants />
      <Toolbar 
        canvasState={canvasState}
        setCanvasState={setCanvasState}
        canRedo={canRedo}
        canUndo={canUndo}
        undo={history.undo}
        redo={history.redo}
      />
      <SelectionTools camera={camera} setLastUsedColor={setLastUsedColor}/>


      <svg className="h-[100vh] w-[100vw]" onPointerDown={onPointerDown} onWheel={onWheel} onPointerMove={onPointerMove} onPointerLeave={onPointerLeave} onPointerUp={onPointerUp}>
        <g style={{ transform:`translate(${camera.x}px, ${camera.y}px)` }}>
          {layerIds.map(layerId => (
            <LayerPreview key={layerId} id={layerId} onLayerPointerDown={onLayerPointerDown} selectionColor={layerIdsToColorSelection[layerId]}/>
          ))}
          <SelectionBox onResizeHandlePointDown={onResizeHandlePointDown}/>
          <CursorsPresence />
          {pencilDraft != null && pencilDraft.length > 0 && (
            <Path 
              points={pencilDraft}
              fill={colorToCss(lastUsedColor)}
              x={0}
              y={0}
            />
          )}
        </g>
      </svg>

    </main>
  )
}

export default Canvas