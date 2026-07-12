import { AppViewer, createGraphicsBackendSingleThread, LoadedResourcesTransferrable } from 'minecraft-renderer'
import { Vec3 } from 'vec3'
import PW from 'prismarine-world'
import PC from 'prismarine-chunk'
import registry from 'prismarine-registry'

const version = '1.21.3'

async function main() {
  const reg = registry(version)
  const Chunk = PC(reg)
  const World = PW(reg)

  const viewer = new AppViewer({
    rendererConfig: {
      wasmMesher: true,
      addChunksBatchWaitTime: 0,
      instantCameraUpdate: true,
    },
    config: {
      sceneBackground: '#87CEEB',
    },
  })
  viewer.resourcesManager.currentConfig = { version }

  const statusEl = document.getElementById('status-text')
  const debugEl = document.getElementById('debug-info')

  statusEl.textContent = 'Loading assets...'
  console.log('[jurobot] Loading assets...')

  try {
    await viewer.resourcesManager.updateAssetsData({})
    console.log('[jurobot] Assets loaded')
  } catch (e) {
    statusEl.textContent = 'Assets failed: ' + e.message
    console.error('[jurobot] Assets error:', e)
    return
  }

  statusEl.textContent = 'Starting renderer...'
  console.log('[jurobot] Loading backend...')
  await viewer.loadBackend(createGraphicsBackendSingleThread)
  console.log('[jurobot] Backend loaded')

  const world = new World()
  await viewer.startWorld(world, 4)
  console.log('[jurobot] World started')

  // Intercept worker messages for debugging
  setTimeout(() => {
    const r = window.world
    if (r?.workers) {
      for (const w of r.workers) {
        const orig = w.onmessage
        w.onmessage = (ev) => {
          const data = ev.data
          if (Array.isArray(data)) {
            console.log('[jurobot] worker msg array:', data.length, 'items, types:', [...new Set(data.map(d => d.type))])
          } else if (data.type) {
            console.log('[jurobot] worker msg:', data.type, 'length:', data.buffer?.byteLength ?? data.length ?? '?')
          }
          if (orig) orig(ev)
        }
        console.log('[jurobot] intercepted worker')
      }
    } else {
      console.log('[jurobot] no workers at intercept time')
    }
  }, 2000)

  // Fallback: if no state arrives, create test chunk at player pos for debugging
  const fallbackTimer = setTimeout(async () => {
    if (worldInit) return // state already received
    console.log('[jurobot] FALLBACK: creating test chunk at 0,0')
    const testChunk = new Chunk()
    const stoneId = reg.blocksByName.stone.defaultState
    for (let x = 0; x < 16; x++) {
      for (let z = 0; z < 16; z++) {
        testChunk.setBlockStateId(new Vec3(x, 70, z), stoneId)
      }
    }
    testChunk.setBlockStateId(new Vec3(0, 71, 0), stoneId)
    testChunk.setBlockStateId(new Vec3(1, 71, 0), stoneId)
    testChunk.setBlockStateId(new Vec3(0, 71, 1), stoneId)
    await world.setColumn(0, 0, testChunk)
    if (viewer.worldView) {
      await viewer.worldView.init(new Vec3(0.5, 71.5, 0.5), {})
      viewer.updateCamera(new Vec3(0.5, 71.5, 0.5), 0, 0)
      console.log('[jurobot] Fallback chunk loaded, camera at (0,71.5,0)')
    }
  }, 8000)

  // Log renderer internals every 5s for debugging
  setInterval(() => {
    if (viewer.worldView) {
      console.log('[jurobot] wv loadedChunks:', Object.keys(viewer.worldView.loadedChunks || {}).length, 'viewDistance:', viewer.worldView.viewDistance)
    }
    try {
      const r = window.world
      if (r) {
        const loaded = Object.keys(r.loadedChunks || {}).length
        const finished = Object.keys(r.finishedChunks || {}).length
        const msgQ = r.messageQueue?.length ?? 0
        console.log('[jurobot] renderer: loadedChunks:', loaded, 'finished:', finished, 'msgQueue:', msgQ, 'workers:', r.workers?.length, 'worldSizeParams:', JSON.stringify(r.worldSizeParams), 'viewDistance:', r.viewDistance)
      } else {
        console.log('[jurobot] no window.world')
      }
    } catch (e) {
      console.error('[jurobot] renderer access error:', e)
    }
  }, 5000)

  const keys = {}
  let camYaw = 0, camPitch = 0
  let pointerLocked = false
  let overrideEnabled = false
  let chatActive = false
  let selectedSlot = 0
  let health = 20, food = 20, armor = 0
  let playerPos = new Vec3(0, 80, 0)
  let playerY = 80
  let worldInit = false
  let isPressing = false
  let pressInterval = null
  let lastRightClick = 0
  let prevX = 0, prevZ = 0, prevY = 0

  const wsProto = location.protocol === 'https:' ? 'wss:' : 'ws:'
  const ws = new WebSocket(wsProto + '//' + location.host + '/ws')

  ws.onopen = () => { statusEl.textContent = 'Connected' }
  ws.onclose = () => {
    statusEl.textContent = 'Disconnected'
    setTimeout(() => location.reload(), 3000)
  }

  ws.onmessage = async (e) => {
    try {
      const d = JSON.parse(e.data)

      if (d.type === 'state') {
        console.log('[jurobot] state:', d.x, d.y, d.z)
        playerPos = new Vec3(d.x, d.y + 1.62, d.z)
        playerY = d.y
        if (!overrideEnabled) {
          const yaw = (d.yaw - 180) * Math.PI / 180
          const pitch = d.pitch * Math.PI / 180
          camYaw = yaw
          camPitch = pitch
          viewer.updateCamera(playerPos, yaw, pitch)
        } else {
          viewer.updateCamera(playerPos, camYaw, camPitch)
        }
        if (viewer.worldView) {
          viewer.worldView.lastPos.update(new Vec3(d.x, playerY, d.z))
          viewer.worldView.emit('chunkPosUpdate', { pos: new Vec3(d.x, playerY, d.z) })
        }

        health = d.health !== void 0 ? d.health : health
        food = d.food !== void 0 ? d.food : food

        updateHP(health)
        updateFood(food)
        updateDebug(d)

        if (d.enabled !== void 0) {
          overrideEnabled = d.enabled
          updateOverrideBtn()
        }
        return
      }

      if (d.type === 'blocks') {
        console.log('[jurobot] blocks received, count:', d.raw?.length / 4 || d.data?.length / 5)
        const data = d.raw || d.data
        if (!data || !data.length) {
          console.log('[jurobot] blocks data empty')
          return
        }

        const chunks = new Map()
        for (let i = 0; i < data.length; i += 4) {
          const bx = data[i], by = data[i + 1], bz = data[i + 2], stateId = data[i + 3]
          const cx = Math.floor(bx / 16), cz = Math.floor(bz / 16)
          const key = cx + ',' + cz
          if (!chunks.has(key)) {
            chunks.set(key, { cx, cz, chunk: new Chunk() })
          }
          const { chunk } = chunks.get(key)
          chunk.setBlockStateId(new Vec3(bx & 15, by, bz & 15), stateId)
        }

        const promises = []
        for (const { cx, cz, chunk } of chunks.values()) {
          // debug: check chunk sections
          if (!worldInit) {
            let nonEmpty = 0
            for (let y = -64; y < 320; y += 16) {
              const s = chunk.sections[(y - (chunk.minY ?? -64)) >> 4]
              if (s && !s.isEmpty()) {
                nonEmpty++
                if (nonEmpty <= 3) console.log('[jurobot] section y=', y, 'block count:', s.storage?.array?.filter?.(v => v !== 0)?.length ?? '?')
              }
            }
            console.log('[jurobot] chunk', cx, cz, 'non-empty sections:', nonEmpty, 'minY:', chunk.minY, 'sections len:', chunk.sections?.length)
          }
          promises.push(world.setColumn(cx, cz, chunk))
        }
        await Promise.all(promises)
        console.log('[jurobot] set', chunks.size, 'columns')

        if (viewer.worldView) {
          const wv = viewer.worldView
          if (!worldInit) {
            worldInit = true
            statusEl.textContent = 'Rendering...'
            const centerX = data[0], centerZ = data[2]
            const initPos = new Vec3(centerX, playerY, centerZ)
            await wv.init(initPos, {})
          }
          for (const { cx, cz } of chunks.values()) {
            const key = (cx * 16) + ',' + (cz * 16)
            if (!wv.loadedChunks[key]) {
              console.log('[jurobot] loadChunk', cx * 16, cz * 16)
              try {
                const col = await world.getColumn(cx, cz)
                if (col) {
                  let ns = 0
                  for (let y = -64; y < 320; y += 16) {
                    const s = col.sections[(y - (col.minY ?? -64)) >> 4]
                    if (s && !s.isEmpty()) ns++
                  }
                  console.log('[jurobot] column from world:', cx, cz, 'non-empty sections:', ns, 'sections:', col.sections?.length)
                } else {
                  console.log('[jurobot] column NOT FOUND in world!', cx, cz)
                }
                await wv.loadChunk({ x: cx * 16, z: cz * 16 })
                console.log('[jurobot] loadChunk done for', cx, cz)
              } catch (e) {
                console.error('[jurobot] loadChunk error:', e)
              }
            } else {
              console.log('[jurobot] already loaded:', key)
            }
          }
          if (!worldInit) {
            statusEl.textContent = 'Connected'
          }
        }
      }

      if (d.type === 'chat') {
        addChatMessage(d.sender === 'System' ? d.msg : (d.sender ? d.sender + ': ' + d.msg : d.msg), d.sender === 'System')
      }
    } catch (e) {
      console.error('WS error:', e)
    }
  }

  function sendOverride(enabled) {
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify({ override: enabled }))
      if (!enabled) {
        ws.send(JSON.stringify({ forward: 0, strafe: 0, jump: false, sneak: false, sprint: false }))
      }
    }
  }

  function sendInput() {
    if (!overrideEnabled) return
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify({
        type: 'input',
        forward: keys['KeyW'] ? 1 : 0,
        strafe: keys['KeyD'] ? 1 : (keys['KeyA'] ? -1 : 0),
        jump: keys['Space'] ? 1 : 0,
        sneak: keys['ShiftLeft'] || keys['ShiftRight'] ? 1 : 0,
        sprint: keys['ControlLeft'] || keys['ControlRight'] ? 1 : 0,
      }))
    }
  }

  document.addEventListener('keydown', (e) => {
    if (e.repeat) return
    if (chatActive) return

    if (e.code === 'F6') {
      overrideEnabled = !overrideEnabled
      sendOverride(overrideEnabled)
      updateOverrideBtn()
      statusEl.textContent = overrideEnabled ? 'Override ON' : 'Override OFF'
      return
    }

    if (!overrideEnabled) return

    if (e.code === 'KeyT') {
      if (document.pointerLockElement) document.exitPointerLock()
      document.getElementById('chat-input-area').style.display = 'flex'
      document.getElementById('chat-input').focus()
      chatActive = true
      e.preventDefault()
      return
    }

    if (e.code === 'KeyE') {
      if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: 'action', action: 'use' }))
      return
    }
    if (e.code === 'KeyQ') {
      if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: 'action', action: 'drop' }))
      return
    }

    if (e.code.startsWith('Digit') && e.code.length === 6) {
      const num = parseInt(e.code[5]) - 1
      if (num >= 0 && num < 9) {
        selectedSlot = num
        updateHotbar()
        if (ws && ws.readyState === 1) {
          ws.send(JSON.stringify({ type: 'action', action: 'swap' }))
        }
      }
      return
    }

    keys[e.code] = true
    sendInput()
  })

  document.addEventListener('keyup', (e) => {
    keys[e.code] = false
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight'].includes(e.code)) {
      if (overrideEnabled) sendInput()
    }
  })

  document.getElementById('chat-input').addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      document.getElementById('chat-input-area').style.display = 'none'
      chatActive = false
      if (!document.pointerLockElement) document.body.requestPointerLock()
      e.preventDefault()
    }
    if (e.key === 'Enter') {
      sendChatMessage()
      e.preventDefault()
    }
  })

  function sendChatMessage() {
    const inp = document.getElementById('chat-input')
    if (!inp.value) return
    const msg = inp.value
    fetch('/say?msg=' + encodeURIComponent(msg))
    inp.value = ''
    addChatMessage(msg, false)
    document.getElementById('chat-input-area').style.display = 'none'
    chatActive = false
    if (!document.pointerLockElement) document.body.requestPointerLock()
  }

  document.addEventListener('mousemove', (e) => {
    if (!pointerLocked || chatActive) return
    camYaw -= e.movementX * 0.002
    camPitch -= e.movementY * 0.002
    camPitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, camPitch))
    viewer.updateCamera(playerPos, camYaw, camPitch)
    const mcYaw = 180 - camYaw * 180 / Math.PI
    const mcPitch = -camPitch * 180 / Math.PI
    if (ws && ws.readyState === 1) {
      if (e.movementX || e.movementY) {
        ws.send(JSON.stringify({ type: 'rotate', yaw: mcYaw, pitch: mcPitch }))
      }
    }
  })

  document.addEventListener('mousedown', (e) => {
    if (!pointerLocked || chatActive || !overrideEnabled) return
    e.preventDefault()
    if (e.button === 0) {
      if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify({ type: 'action', action: 'swing' }))
      }
      if (!isPressing) {
        isPressing = true
        pressInterval = setInterval(() => {
          if (ws && ws.readyState === 1) {
            ws.send(JSON.stringify({ type: 'action', action: 'swing' }))
          }
        }, 250)
      }
    }
    if (e.button === 2) {
      if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify({ type: 'action', action: 'use' }))
      }
    }
  })

  document.addEventListener('mouseup', (e) => {
    if (e.button === 0 && isPressing) {
      isPressing = false
      if (pressInterval) {
        clearInterval(pressInterval)
        pressInterval = null
      }
    }
  })

  document.addEventListener('click', () => {
    if (chatActive) return
    if (!pointerLocked && !document.pointerLockElement) {
      document.body.requestPointerLock()
    }
  })

  document.addEventListener('pointerlockchange', () => {
    pointerLocked = !!document.pointerLockElement
    document.getElementById('click-hint').style.display = pointerLocked ? 'none' : 'block'
  })

  document.addEventListener('contextmenu', (e) => e.preventDefault())

  document.addEventListener('wheel', (e) => {
    if (chatActive) return
    const dir = e.deltaY > 0 ? 1 : -1
    selectedSlot = (selectedSlot + dir + 9) % 9
    updateHotbar()
    if (overrideEnabled && ws && ws.readyState === 1) {
      ws.send(JSON.stringify({ type: 'action', action: 'swap' }))
    }
  })

  // DocumentRenderer handles resize internally

  const overrideBtn = document.getElementById('override-btn')
  overrideBtn.addEventListener('click', () => {
    overrideEnabled = !overrideEnabled
    sendOverride(overrideEnabled)
    updateOverrideBtn()
    statusEl.textContent = overrideEnabled ? 'Override ON' : 'Override OFF'
    if (overrideEnabled) {
      document.body.requestPointerLock()
    }
  })

  function updateOverrideBtn() {
    if (overrideEnabled) {
      overrideBtn.textContent = 'OVERRIDE ACTIVE'
      overrideBtn.classList.add('active')
    } else {
      overrideBtn.textContent = 'OVERRIDE'
      overrideBtn.classList.remove('active')
    }
  }

  function updateHP(val) {
    const hp = Math.round(val / 2)
    const container = document.getElementById('hp-icons')
    let html = ''
    for (let i = 0; i < 10; i++) {
      const cls = i < hp ? '' : 'empty'
      html += '<div class="icon ' + cls + '"></div>'
    }
    container.innerHTML = html
  }

  function updateFood(val) {
    const f = Math.round(val / 2)
    const container = document.getElementById('food-icons')
    let html = ''
    for (let i = 0; i < 10; i++) {
      const cls = i < f ? '' : 'empty'
      html += '<div class="icon ' + cls + '"></div>'
    }
    container.innerHTML = html
  }

  function updateDebug(d) {
    const dx = d.x !== void 0 ? d.x.toFixed(1) : '--'
    const dy = d.y !== void 0 ? d.y.toFixed(1) : '--'
    const dz = d.z !== void 0 ? d.z.toFixed(1) : '--'
    const dyaw = d.yaw !== void 0 ? (Math.round(d.yaw) % 360) : '--'
    const dpitch = d.pitch !== void 0 ? Math.round(d.pitch) : '--'
    const ping = d.ping !== void 0 ? d.ping + 'ms' : '--'
    debugEl.innerHTML =
      'XYZ: ' + dx + ' / ' + dy + ' / ' + dz +
      '<br>Yaw: ' + dyaw + '°  Pitch: ' + dpitch + '°' +
      '<br>Ping: ' + ping
  }

  function addChatMessage(msg, isSystem) {
    const container = document.getElementById('chat-messages')
    const div = document.createElement('div')
    div.className = 'chat-msg' + (isSystem ? ' system' : '')
    div.textContent = msg
    container.appendChild(div)
    while (container.children.length > 50) container.removeChild(container.firstChild)
  }

  function updateHotbar() {
    const slots = document.querySelectorAll('#hotbar .slot')
    slots.forEach((slot, i) => {
      slot.classList.toggle('active', i === selectedSlot)
    })
  }

  function buildHotbar() {
    const hotbarEl = document.getElementById('hotbar')
    let html = ''
    for (let i = 0; i < 9; i++) {
      html += '<div class="slot' + (i === selectedSlot ? ' active' : '') + '"><span class="num">' + (i + 1) + '</span></div>'
    }
    hotbarEl.innerHTML = html
  }
  buildHotbar()

  statusEl.textContent = 'Waiting for data...'
}

window.addEventListener('error', (e) => {
  console.error('[jurobot] Global error:', e.message)
  document.getElementById('status-text').textContent = 'Error: ' + e.message
})
window.addEventListener('unhandledrejection', (e) => {
  console.error('[jurobot] Unhandled rejection:', e.reason)
  document.getElementById('status-text').textContent = 'Error: ' + (e.reason?.message || String(e.reason))
})

main().catch(e => {
  console.error(e)
  document.getElementById('status-text').textContent = 'Error: ' + e.message
})
