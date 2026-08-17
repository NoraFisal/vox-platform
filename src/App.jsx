import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import './App.css'
import { translations } from './data/translations'
import DialogueSetup from './components/DialogueSetup'

const baseScenes = []

const VOX_DB_NAME = 'vox-local-library'
const VOX_DB_VERSION = 1
const VOX_SCENES_STORE = 'published-scenes'

function openVoxDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(
      VOX_DB_NAME,
      VOX_DB_VERSION
    )

    request.onupgradeneeded = () => {
      const db = request.result

      if (
        !db.objectStoreNames.contains(
          VOX_SCENES_STORE
        )
      ) {
        db.createObjectStore(
          VOX_SCENES_STORE,
          {
            keyPath: 'id',
          }
        )
      }
    }

    request.onsuccess = () =>
      resolve(request.result)

    request.onerror = () =>
      reject(request.error)
  })
}

async function savePublishedSceneRecord(record) {
  const db = await openVoxDb()

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(
      VOX_SCENES_STORE,
      'readwrite'
    )

    transaction
      .objectStore(
        VOX_SCENES_STORE
      )
      .put(record)

    transaction.oncomplete = () => {
      db.close()
      resolve()
    }

    transaction.onerror = () => {
      db.close()
      reject(transaction.error)
    }
  })
}

async function getPublishedSceneRecord(sceneId) {
  const db = await openVoxDb()

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(
      VOX_SCENES_STORE,
      'readonly'
    )

    const request =
      transaction
        .objectStore(
          VOX_SCENES_STORE
        )
        .get(sceneId)

    request.onsuccess = () =>
      resolve(request.result || null)

    request.onerror = () =>
      reject(request.error)

    transaction.oncomplete = () =>
      db.close()
  })
}

async function deletePublishedSceneRecord(sceneId) {
  const db = await openVoxDb()

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(
      VOX_SCENES_STORE,
      'readwrite'
    )

    transaction
      .objectStore(
        VOX_SCENES_STORE
      )
      .delete(sceneId)

    transaction.oncomplete = () => {
      db.close()
      resolve()
    }

    transaction.onerror = () => {
      db.close()
      reject(transaction.error)
    }
  })
}

async function updatePublishedSceneRecord(
  sceneId,
  updates
) {
  const existing =
    await getPublishedSceneRecord(
      sceneId
    )

  if (!existing) return

  await savePublishedSceneRecord({
    ...existing,
    ...updates,
    scene: {
      ...existing.scene,
      ...(updates.scene || {}),
    },
  })
}

async function loadPublishedSceneRecords() {
  const db = await openVoxDb()

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(
      VOX_SCENES_STORE,
      'readonly'
    )

    const request =
      transaction
        .objectStore(
          VOX_SCENES_STORE
        )
        .getAll()

    request.onsuccess = () => {
      resolve(request.result || [])
    }

    request.onerror = () =>
      reject(request.error)

    transaction.oncomplete = () =>
      db.close()
  })
}

function getSetupKey(sceneId, mode) {
  return `vox-scene-setup-${sceneId}-${mode}`
}


function publicBackendUrl(url) {
  if (!url) return url

  try {
    const parsed = new URL(
      url,
      window.location.origin
    )

    if (
      parsed.hostname === '127.0.0.1' ||
      parsed.hostname === 'localhost'
    ) {
      if (parsed.port === '8001') {
        return `/api-analysis${parsed.pathname}${parsed.search}`
      }

      if (parsed.port === '8002') {
        return `/api-mix${parsed.pathname}${parsed.search}`
      }

      if (parsed.port === '8003') {
        return `/rooms-api${parsed.pathname}${parsed.search}`
      }
    }

    return url
  } catch {
    return url
  }
}

const IS_LOCAL =
  window.location.hostname === 'localhost' ||
  window.location.hostname === '127.0.0.1'

const API_BASE = IS_LOCAL
  ? ''
  : 'https://vox-platform.onrender.com'

const ANALYSIS_API = IS_LOCAL
  ? '/api-analysis'
  : `${API_BASE}/api`

const MIX_API = IS_LOCAL
  ? '/api-mix'
  : `${API_BASE}/api-mix`

const ROOMS_API = IS_LOCAL
  ? ROOMS_API
  : `${API_BASE}/rooms-api`

const ACCOUNTS_API = IS_LOCAL
  ? ACCOUNTS_API
  : `${API_BASE}/accounts-api`


async function createInviteRoomRequest(scene) {
  const response = await fetch(`${ROOMS_API}/rooms`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      scene_id: scene.id,
      scene_title: scene.title || '',
      scene_title_ar: scene.titleAr || '',
      mode: 'invite',
    }),
  })

  if (!response.ok) {
    throw new Error(
      (await response.text()) ||
      'Could not create invite room.'
    )
  }

  return response.json()
}

async function getInviteRoomRequest(roomCode) {
  const response = await fetch(
    `${ROOMS_API}/rooms/${encodeURIComponent(roomCode)}?t=${Date.now()}`,
    {
      cache: 'no-store',
    }
  )

  if (!response.ok) {
    throw new Error(
      (await response.text()) ||
      'Room not found.'
    )
  }

  return response.json()
}

async function joinInviteRoomRequest(
  roomCode,
  displayName
) {
  const response = await fetch(
    `${ROOMS_API}/rooms/${encodeURIComponent(roomCode)}/join`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        display_name: displayName,
      }),
    }
  )

  if (!response.ok) {
    throw new Error(
      (await response.text()) ||
      'Could not join room.'
    )
  }

  return response.json()
}


async function uploadInviteSceneRequest(
  roomCode,
  token,
  scene,
  analysis
) {
  const response =
    await fetch(
      scene.videoUrl
    )

  if (!response.ok) {
    throw new Error(
      'Could not load the shared scene video.'
    )
  }

  const blob =
    await response.blob()

  const formData =
    new FormData()

  formData.append(
    'token',
    token
  )

  formData.append(
    'analysis',
    JSON.stringify(
      analysis || {}
    )
  )

  formData.append(
    'video',
    blob,
    `${scene.id}.mp4`
  )

  const uploadResponse =
    await fetch(
      `${ROOMS_API}/rooms/${encodeURIComponent(roomCode)}/scene`,
      {
        method: 'POST',
        body: formData,
      }
    )

  if (!uploadResponse.ok) {
    throw new Error(
      (await uploadResponse.text()) ||
      'Could not prepare the shared room scene.'
    )
  }

  return uploadResponse.json()
}

async function saveInviteSetupRequest(
  roomCode,
  token,
  setup
) {
  const response =
    await fetch(
      `${ROOMS_API}/rooms/${encodeURIComponent(roomCode)}/setup`,
      {
        method: 'PUT',
        headers: {
          'Content-Type':
            'application/json',
          Authorization:
            `Bearer ${token}`,
        },
        body: JSON.stringify({
          setup,
        }),
      }
    )

  if (!response.ok) {
    throw new Error(
      (await response.text()) ||
      'Could not save room setup.'
    )
  }

  return response.json()
}


async function uploadInviteTakeRequest(
  roomCode,
  token,
  line,
  take
) {
  const formData =
    new FormData()

  formData.append(
    'token',
    token
  )

  formData.append(
    'line_start',
    String(
      line.start
    )
  )

  formData.append(
    'line_end',
    String(
      line.end
    )
  )

  formData.append(
    'capture_start',
    String(
      take.start ??
      line.start
    )
  )

  formData.append(
    'capture_end',
    String(
      take.end ??
      line.end
    )
  )

  formData.append(
    'offset_ms',
    String(
      take.offsetMs || 0
    )
  )

  formData.append(
    'take',
    take.blob,
    `take-${line.id}.webm`
  )

  const response =
    await fetch(
      `${ROOMS_API}/rooms/${encodeURIComponent(roomCode)}/takes/${encodeURIComponent(line.id)}`,
      {
        method: 'POST',
        body: formData,
      }
    )

  if (!response.ok) {
    throw new Error(
      (await response.text()) ||
      'Could not upload this take.'
    )
  }

  return response.json()
}

async function finishInviteParticipantRequest(
  roomCode,
  token
) {
  const response =
    await fetch(
      `${ROOMS_API}/rooms/${encodeURIComponent(roomCode)}/finish`,
      {
        method: 'POST',
        headers: {
          Authorization:
            `Bearer ${token}`,
        },
      }
    )

  if (!response.ok) {
    throw new Error(
      (await response.text()) ||
      'Could not finish your part.'
    )
  }

  return response.json()
}

async function renderInviteIfReadyRequest(
  roomCode
) {
  const response =
    await fetch(
      `${ROOMS_API}/rooms/${encodeURIComponent(roomCode)}/render-if-ready`,
      {
        method: 'POST',
      }
    )

  if (!response.ok) {
    throw new Error(
      (await response.text()) ||
      'Could not build the shared final dub.'
    )
  }

  return response.json()
}


const ACCOUNT_API = '/account-api'

async function accountRequest(path, options = {}) {
  const response = await fetch(
    `${ACCOUNT_API}${path}`,
    {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    }
  )

  const payload =
    await response.json().catch(() => ({}))

  if (!response.ok) {
    throw new Error(
      payload.detail ||
      payload.message ||
      'Account request failed.'
    )
  }

  return payload
}

function App() {
  const [theme, setTheme] = useState('dark')
  const [language, setLanguage] = useState('en')

  const [screen, setScreen] = useState('home')

  const [accountToken, setAccountToken] =
    useState(() =>
      localStorage.getItem('vox-account-token') || ''
    )

  const [accountUser, setAccountUser] =
    useState(null)

  const [accountBusy, setAccountBusy] =
    useState(false)

  const [accountError, setAccountError] =
    useState('')

  const [paywallOpen, setPaywallOpen] =
    useState(false)

  const [joinCode, setJoinCode] =
    useState('')

  const [joinRoomModalOpen, setJoinRoomModalOpen] =
    useState(false)

  const chargedScenesRef =
    useRef(new Set())


  const [userScenes, setUserScenes] = useState([])
  const publishedObjectUrlsRef = useRef([])

  const [selectedScene, setSelectedScene] = useState(null)

  const [selectedMode, setSelectedMode] = useState('solo')

  const [inviteRoom, setInviteRoom] = useState(null)
  const [inviteBusy, setInviteBusy] = useState(false)
  const [inviteError, setInviteError] = useState('')
  const [inviteParticipantRole, setInviteParticipantRole] =
    useState(null)

  const [inviteTakeBusy, setInviteTakeBusy] =
    useState(false)

  const [inviteTakeError, setInviteTakeError] =
    useState('')

  const [sceneAnalysis, setSceneAnalysis] = useState(null)
  const [sceneSetup, setSceneSetup] = useState(null)

  const [analysisCache, setAnalysisCache] = useState({})

  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [analysisError, setAnalysisError] = useState('')
  const [analysisProgress, setAnalysisProgress] = useState(0)
  const [analysisStage, setAnalysisStage] = useState('')

  const progressTimerRef = useRef(null)

  const [activeTurn, setActiveTurn] = useState(0)
  const [segmentState, setSegmentState] =
    useState('preview')

  const [recordingTakes, setRecordingTakes] = useState({})

  const [
    editingSetupFromRecording,
    setEditingSetupFromRecording,
  ] = useState(false)

  const [search, setSearch] = useState('')
  const [libraryFilter, setLibraryFilter] = useState('all')

  const t = translations[language]
  const isArabic = language === 'ar'



  const refreshAccount = async (token = accountToken) => {
    if (!token) {
      setAccountUser(null)
      return null
    }

    try {
      const profile =
        await accountRequest(
          '/me',
          {
            headers: {
              Authorization:
                `Bearer ${token}`,
            },
          }
        )

      setAccountUser(profile)
      return profile
    } catch (error) {
      localStorage.removeItem(
        'vox-account-token'
      )
      setAccountToken('')
      setAccountUser(null)
      return null
    }
  }

  useEffect(() => {
    if (accountToken) {
      refreshAccount(accountToken)
    }
  }, [accountToken])

  const handleAuth = async ({
    mode,
    name,
    email,
    password,
    acceptedTerms,
  }) => {
    setAccountBusy(true)
    setAccountError('')

    try {
      const path =
        mode === 'signup'
          ? '/signup'
          : '/login'

      const payload =
        await accountRequest(
          path,
          {
            method: 'POST',
            body: JSON.stringify({
              name,
              email,
              password,
              accepted_terms:
                acceptedTerms,
            }),
          }
        )

      localStorage.setItem(
        'vox-account-token',
        payload.token
      )

      setAccountToken(
        payload.token
      )

      setAccountUser(
        payload.user
      )

      setScreen('home')
    } catch (error) {
      setAccountError(
        error.message
      )
    } finally {
      setAccountBusy(false)
    }
  }

  const logoutAccount = () => {
    localStorage.removeItem(
      'vox-account-token'
    )

    setAccountToken('')
    setAccountUser(null)
    setScreen('home')
  }

  const simulatePurchase =
    async (packageName) => {
      if (!accountToken) {
        setScreen('auth')
        return
      }

      setAccountBusy(true)
      setAccountError('')

      try {
        const profile =
          await accountRequest(
            '/purchase/simulate',
            {
              method: 'POST',
              headers: {
                Authorization:
                  `Bearer ${accountToken}`,
              },
              body: JSON.stringify({
                package:
                  packageName,
              }),
            }
          )

        setAccountUser(profile)
        setPaywallOpen(false)
      } catch (error) {
        setAccountError(
          error.message
        )
      } finally {
        setAccountBusy(false)
      }
    }

  const ensureCreationCredit =
    async () => {
      if (
        selectedMode === 'invite' &&
        inviteParticipantRole === 'guest'
      ) {
        return true
      }

      if (!accountToken) {
        setScreen('auth')
        return false
      }

      const sceneKey =
        selectedScene?.id

      if (
        sceneKey &&
        chargedScenesRef.current.has(
          sceneKey
        )
      ) {
        return true
      }

      try {
        const profile =
          await accountRequest(
            '/consume',
            {
              method: 'POST',
              headers: {
                Authorization:
                  `Bearer ${accountToken}`,
              },
              body: JSON.stringify({
                scene_id:
                  sceneKey || 'scene',
                mode:
                  selectedMode,
              }),
            }
          )

        if (sceneKey) {
          chargedScenesRef.current.add(
            sceneKey
          )
        }

        setAccountUser(profile)
        return true
      } catch (error) {
        if (
          String(error.message)
            .toLowerCase()
            .includes('credit')
        ) {
          setPaywallOpen(true)
          return false
        }

        setAccountError(
          error.message
        )

        return false
      }
    }


  const startSelectedSceneMode =
    async () => {
      if (selectedMode === 'invite') {
        setInviteTakeError('')

        try {
          const sceneForRoom =
            selectedScene

          if (!sceneForRoom) {
            return
          }

          const result =
            await createInviteRoom(
              sceneForRoom
            )

          if (result?.roomCode) {
            return
          }
        } catch (error) {
          setInviteTakeError(
            error?.message ||
            'Could not create the invite room.'
          )
        }

        return
      }

      setScreen('dialogue')
    }

  const joinRoomByCode =
    async (rawCode) => {
      const code =
        String(rawCode || '')
          .trim()
          .toUpperCase()

      if (!code) return

      const url =
        new URL(
          window.location.href
        )

      url.search = ''
      url.searchParams.set(
        'room',
        code
      )

      window.location.href =
        url.toString()
    }

  useEffect(() => {
    let cancelled = false

    const restorePublishedScenes = async () => {
      try {
        const records =
          await loadPublishedSceneRecords()

        if (cancelled) return

        const restoredAnalyses = {}

        const restored =
          records.map((record) => {
            const videoUrl =
              URL.createObjectURL(
                record.videoBlob
              )

            publishedObjectUrlsRef.current.push(
              videoUrl
            )

            if (
              record.setup &&
              record.mode
            ) {
              localStorage.setItem(
                getSetupKey(
                  record.id,
                  record.mode
                ),
                JSON.stringify(
                  record.setup
                )
              )
            }

            if (record.analysis) {
              restoredAnalyses[
                record.id
              ] =
                record.analysis
            }

            return {
              ...record.scene,
              id: record.id,
              videoUrl,
              isUpload: true,
              community: true,
              trending: false,
            }
          })

        setUserScenes(restored)

        setAnalysisCache(
          (current) => ({
            ...current,
            ...restoredAnalyses,
          })
        )
      } catch (error) {
        console.error(
          'Could not restore published scenes:',
          error
        )
      }
    }

    restorePublishedScenes()

    return () => {
      cancelled = true

      publishedObjectUrlsRef.current
        .forEach((url) =>
          URL.revokeObjectURL(url)
        )

      publishedObjectUrlsRef.current = []
    }
  }, [])


  useEffect(() => {
    const params =
      new URLSearchParams(
        window.location.search
      )

    const roomCode =
      params.get('room')

    if (!roomCode) return

    let cancelled = false

    ;(async () => {
      try {
        setInviteBusy(true)
        setInviteError('')

        const room =
          await getInviteRoomRequest(
            roomCode
          )

        if (cancelled) return

        const token =
          localStorage.getItem(
            `vox-room-token-${roomCode}`
          )

        const participantRole =
          localStorage.getItem(
            `vox-room-role-${roomCode}`
          )

        setInviteParticipantRole(
          participantRole || null
        )

        setInviteRoom({
          ...room,
          participant_token:
            token || null,
          participant_role:
            participantRole || null,
        })

        if (room.scene_video_url) {
          setSelectedScene({
            id: room.scene_id,
            title: room.scene_title,
            titleAr:
              room.scene_title_ar ||
              room.scene_title,
            category: 'Invite',
            categoryAr: 'دعوة',
            mode: 'duo',
            characters: 2,
            videoUrl:
              room.scene_video_url,
            isInviteRoom: true,
          })
        }

        if (room.analysis) {
          setSceneAnalysis(
            room.analysis
          )

          setAnalysisCache(
            (current) => ({
              ...current,
              [room.scene_id]:
                room.analysis,
            })
          )
        }

        if (room.setup) {
          setSceneSetup(
            room.setup
          )
        }

        setSelectedMode('invite')
        setScreen('inviteRoom')
      } catch (error) {
        if (!cancelled) {
          setInviteError(
            error.message ||
            'Could not open invite room.'
          )

          setScreen('inviteRoom')
        }
      } finally {
        if (!cancelled) {
          setInviteBusy(false)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

  const scenes = useMemo(
    () => [...baseScenes, ...userScenes],
    [userScenes]
  )

  const filteredScenes = useMemo(() => {
    const query = search.trim().toLowerCase()

    return scenes.filter((scene) => {
      const searchableText = `
        ${scene.title}
        ${scene.titleAr}
        ${scene.category}
        ${scene.categoryAr}
      `.toLowerCase()

      const matchesSearch =
        !query || searchableText.includes(query)

      let matchesFilter = true

      if (libraryFilter === 'trending') {
        matchesFilter = scene.trending === true
      }

      if (libraryFilter === 'duo') {
        matchesFilter =
          scene.mode === 'duo' ||
          scene.characters === 2
      }

      if (libraryFilter === 'community') {
        matchesFilter = scene.community === true
      }

      return matchesSearch && matchesFilter
    })
  }, [search, scenes, libraryFilter])

  const currentAnalysis =
    analysisCache[selectedScene?.id] || sceneAnalysis

  const recordingTurns = useMemo(() => {
    if (!sceneSetup?.dialogue) return []

    if (
      selectedMode === 'invite' &&
      inviteParticipantRole
    ) {
      const assignedRole =
        inviteParticipantRole === 'host'
          ? 'person-1'
          : 'person-2'

      return sceneSetup.dialogue.filter(
        (line) =>
          line.role === assignedRole
      )
    }

    return sceneSetup.dialogue.filter(
      (line) =>
        line.role !== 'original'
    )
  }, [
    sceneSetup,
    selectedMode,
    inviteParticipantRole,
  ])

  function getAnalysisStage(progress) {
    if (progress < 25) {
      return t.analysis.reading
    }

    if (progress < 48) {
      return t.analysis.audio
    }

    if (progress < 76) {
      return t.analysis.dialogue
    }

    if (progress < 93) {
      return t.analysis.waveform
    }

    return t.analysis.finishing
  }

  function beginAnalysisProgress() {
    if (progressTimerRef.current) {
      clearInterval(progressTimerRef.current)
    }

    setAnalysisProgress(6)
    setAnalysisStage(t.analysis.reading)

    progressTimerRef.current = setInterval(() => {
      setAnalysisProgress((current) => {
        if (current >= 91) return current

        const next =
          current < 30
            ? current + 4
            : current < 65
              ? current + 3
              : current + 1

        setAnalysisStage(getAnalysisStage(next))

        return Math.min(next, 91)
      })
    }, 520)
  }

  function finishAnalysisProgress() {
    if (progressTimerRef.current) {
      clearInterval(progressTimerRef.current)
      progressTimerRef.current = null
    }

    setAnalysisProgress(100)
    setAnalysisStage(t.analysis.ready)
  }

  function resetAnalysisProgress() {
    if (progressTimerRef.current) {
      clearInterval(progressTimerRef.current)
      progressTimerRef.current = null
    }

    setAnalysisProgress(0)
    setAnalysisStage('')
  }

  const openScene = (scene) => {
    setEditingSetupFromRecording(false)
    setSelectedScene(scene)

    setSelectedMode(
      scene.mode === 'duo'
        ? 'solo'
        : scene.mode
    )

    setSceneSetup(null)

    setSceneAnalysis(
      analysisCache[scene.id] || null
    )

    setAnalysisError('')
    resetAnalysisProgress()

    setScreen('scene')

    window.scrollTo({
      top: 0,
      behavior: 'smooth',
    })
  }

  const goHome = () => {
    setScreen('home')

    window.scrollTo({
      top: 0,
      behavior: 'smooth',
    })
  }

  const openDuoLibrary = () => {
    setScreen('home')
    setLibraryFilter('duo')

    setTimeout(() => {
      document
        .getElementById('library')
        ?.scrollIntoView({
          behavior: 'smooth',
        })
    }, 0)
  }

  async function prepareSceneForDub(
    file,
    sceneId
  ) {
    const formData =
      new FormData()

    formData.append(
      'video',
      file,
      file.name ||
      `${sceneId}.mp4`
    )

    const response =
      await fetch(
        `${MIX_API}/prepare-scene`,
        {
          method: 'POST',
          body: formData,
        }
      )

    if (!response.ok) {
      const details =
        await response.text()

      throw new Error(
        details ||
        'Could not prepare clean background audio.'
      )
    }

    const data =
      await response.json()

    return {
      ...data,
      background_url:
        publicBackendUrl(
          data.background_url
        ),
    }
  }

  async function analyzeFile(
    file,
    sceneId,
    speechLanguage = 'auto'
  ) {
    const formData = new FormData()

    formData.append(
      'video',
      file,
      file.name || `${sceneId}.mp4`
    )

    formData.append(
      'language',
      speechLanguage
    )

    const response = await fetch(
      `${ANALYSIS_API}/analyze-video`,
      {
        method: 'POST',
        body: formData,
      }
    )

    if (!response.ok) {
      throw new Error(
        'Scene analysis failed.'
      )
    }

    return response.json()
  }

  async function analyzeSceneVideo(scene) {
    const response = await fetch(scene.videoUrl)

    if (!response.ok) {
      throw new Error(
        'Could not load the scene video.'
      )
    }

    const blob = await response.blob()

    const file = new File(
      [blob],
      `${scene.id}.mp4`,
      {
        type: blob.type || 'video/mp4',
      }
    )

    return analyzeFile(
      file,
      scene.id,
      scene.speechLanguage || 'auto'
    )
  }


  const createInviteRoom = async () => {
    if (!selectedScene) {
      setInviteError(
        language === 'ar'
          ? 'ما تم العثور على المشهد.'
          : 'No scene is selected.'
      )
      return
    }

    try {
      setInviteBusy(true)
      setInviteError('')

      const room =
        await createInviteRoomRequest(
          selectedScene
        )

      localStorage.setItem(
        `vox-room-token-${room.room_code}`,
        room.host_token
      )

      localStorage.setItem(
        `vox-room-role-${room.room_code}`,
        'host'
      )

      setInviteParticipantRole(
        'host'
      )

      const sharedRoom =
        await uploadInviteSceneRequest(
          room.room_code,
          room.host_token,
          selectedScene,
          currentAnalysis
        )

      setInviteRoom({
        ...room,
        ...sharedRoom,
        participant_token:
          room.host_token,
        participant_role:
          'host',
      })

      const url =
        new URL(
          window.location.href
        )

      url.search = ''
      url.searchParams.set(
        'room',
        room.room_code
      )

      window.history.replaceState(
        {},
        '',
        url.toString()
      )

      setScreen('inviteRoom')

      window.scrollTo({
        top: 0,
        behavior: 'smooth',
      })
    } catch (error) {
      console.error(error)

      const rawMessage =
        error?.message || ''

      const roomServerUnavailable =
        rawMessage.includes('fetch') ||
        rawMessage.includes('502') ||
        rawMessage.includes('ECONNREFUSED') ||
        rawMessage.includes('Failed')

      setInviteError(
        roomServerUnavailable
          ? (
            language === 'ar'
              ? 'تعذر الاتصال بخدمة الغرف. تأكد أن Room Server يعمل على المنفذ 8003 ثم حاول مرة أخرى.'
              : 'Could not reach the room service. Make sure the Room Server is running on port 8003, then try again.'
          )
          : (
            rawMessage ||
            (
              language === 'ar'
                ? 'تعذر إنشاء غرفة الدعوة.'
                : 'Could not create invite room.'
            )
          )
      )
    } finally {
      setInviteBusy(false)
    }
  }

  const startVoiceOver = async () => {
    setEditingSetupFromRecording(false)
    setAnalysisError('')

    const setupKey =
      getSetupKey(
        selectedScene.id,
        selectedMode
      )

    let savedSetup = null

    const saved =
      localStorage.getItem(
        setupKey
      )

    if (saved) {
      try {
        savedSetup =
          JSON.parse(saved)
      } catch {
        localStorage.removeItem(
          setupKey
        )
      }
    }

    const cached =
      analysisCache[
      selectedScene.id
      ]

    /*
      A library scene can have an old saved setup
      that was created before the clean-background
      pipeline existed.

      Never skip preparation unless we already have
      a valid dub job.
    */
    const existingMix =
      savedSetup?.mix?.job_id
        ? savedSetup.mix
        : cached?.mix?.job_id
          ? cached.mix
          : null

    if (existingMix) {
      const preparedAnalysis = {
        ...(cached || {}),
        mix: existingMix,
      }

      setSceneAnalysis(
        preparedAnalysis
      )

      if (savedSetup) {
        const preparedSetup = {
          ...savedSetup,
          mix: existingMix,
        }

        setSceneSetup(
          preparedSetup
        )

        localStorage.setItem(
          setupKey,
          JSON.stringify(
            preparedSetup
          )
        )
      } else {
        setSceneSetup(null)
      }

      setScreen(
        'dialogueSetup'
      )

      window.scrollTo({
        top: 0,
        behavior: 'smooth',
      })

      return
    }

    try {
      setIsAnalyzing(true)
      beginAnalysisProgress()

      /*
        Reuse transcript/timestamps if they already
        exist. We only regenerate them when needed.
      */
      const analysis =
        cached ||
        await analyzeSceneVideo(
          selectedScene
        )

      setAnalysisProgress(94)

      setAnalysisStage(
        language === 'ar'
          ? 'تجهيز الخلفية الصوتية...'
          : 'Preparing clean background audio...'
      )

      const videoResponse =
        await fetch(
          selectedScene.videoUrl
        )

      if (!videoResponse.ok) {
        throw new Error(
          'Could not load scene for audio preparation.'
        )
      }

      const videoBlob =
        await videoResponse.blob()

      const sceneFile =
        new File(
          [videoBlob],
          `${selectedScene.id}.mp4`,
          {
            type:
              videoBlob.type ||
              'video/mp4',
          }
        )

      const mix =
        await prepareSceneForDub(
          sceneFile,
          selectedScene.id
        )

      const preparedAnalysis = {
        ...analysis,
        mix,
      }

      setSceneAnalysis(
        preparedAnalysis
      )

      setAnalysisCache(
        (current) => ({
          ...current,
          [selectedScene.id]:
            preparedAnalysis,
        })
      )

      /*
        If this scene came from the persistent
        public library, update its stored analysis
        too so it stays prepared next time.
      */
      updatePublishedSceneRecord(
        selectedScene.id,
        {
          analysis:
            preparedAnalysis,
        }
      ).catch(() => { })

      if (savedSetup) {
        const preparedSetup = {
          ...savedSetup,
          mix,
        }

        setSceneSetup(
          preparedSetup
        )

        localStorage.setItem(
          setupKey,
          JSON.stringify(
            preparedSetup
          )
        )

        updatePublishedSceneRecord(
          selectedScene.id,
          {
            setup:
              preparedSetup,
          }
        ).catch(() => { })
      } else {
        setSceneSetup(null)
      }

      finishAnalysisProgress()

      setTimeout(() => {
        setScreen(
          'dialogueSetup'
        )

        window.scrollTo({
          top: 0,
          behavior: 'smooth',
        })

        resetAnalysisProgress()
      }, 350)
    } catch (error) {
      console.error(error)

      resetAnalysisProgress()

      setAnalysisError(
        language === 'ar'
          ? 'تعذّر تجهيز المشهد. يرجى المحاولة مرة أخرى.'
          : 'We could not prepare this scene. Please try again.'
      )
    } finally {
      setIsAnalyzing(false)
    }
  }

  const approveDialogueSetup = async (setup) => {
    const setupKey = getSetupKey(
      selectedScene.id,
      selectedMode
    )

    const completeSetup = {
      ...setup,

      sceneId: selectedScene.id,

      waveform:
        currentAnalysis?.waveform ||
        sceneSetup?.waveform ||
        [],

      duration:
        currentAnalysis?.duration_seconds ||
        sceneSetup?.duration ||
        null,

      mix:
        currentAnalysis?.mix ||
        sceneSetup?.mix ||
        null,
    }

    if (
      selectedMode === 'invite' &&
      inviteRoom?.room_code &&
      inviteParticipantRole === 'host'
    ) {
      try {
        const updatedRoom =
          await saveInviteSetupRequest(
            inviteRoom.room_code,
            inviteRoom.participant_token,
            completeSetup
          )

        setInviteRoom(
          (current) => ({
            ...current,
            ...updatedRoom,
            participant_token:
              current?.participant_token,
            participant_role:
              current?.participant_role,
          })
        )
      } catch (error) {
        console.error(
          'Could not save invite setup:',
          error
        )

        setInviteError(
          language === 'ar'
            ? 'تعذّر حفظ توزيع الأدوار في الغرفة.'
            : 'Could not save role assignments to the room.'
        )

        return
      }
    }

    const nextRecordingTurns =
      (completeSetup.dialogue || [])
        .filter(
          (line) =>
            line.role !== 'original'
        )

    const currentTurnId =
      recordingTurns[
        activeTurn
      ]?.id

    const validTakeIds =
      new Set(
        nextRecordingTurns.map(
          (line) => line.id
        )
      )

    let nextTakes =
      recordingTakes

    if (
      editingSetupFromRecording
    ) {
      nextTakes =
        Object.fromEntries(
          Object.entries(
            recordingTakes
          ).filter(
            ([lineId]) =>
              validTakeIds.has(
                lineId
              )
          )
        )
    } else {
      nextTakes = {}
    }

    setSceneSetup(
      completeSetup
    )

    localStorage.setItem(
      setupKey,
      JSON.stringify(
        completeSetup
      )
    )

    if (
      selectedScene.isUpload
    ) {
      if (
        completeSetup.publish
      ) {
        const publishedScene = {
          ...selectedScene,
          community: true,
          trending: false,
        }

        setUserScenes(
          (current) => {
            const withoutCurrent =
              current.filter(
                (scene) =>
                  scene.id !==
                  selectedScene.id
              )

            return [
              ...withoutCurrent,
              publishedScene,
            ]
          }
        )

          ; (async () => {
            try {
              const existing =
                await getPublishedSceneRecord(
                  selectedScene.id
                )

              const videoBlob =
                selectedScene.sourceFile ||
                existing?.videoBlob

              if (!videoBlob) {
                return
              }

              await savePublishedSceneRecord({
                id:
                  selectedScene.id,

                scene: {
                  ...publishedScene,
                  videoUrl:
                    undefined,
                  sourceFile:
                    undefined,
                },

                videoBlob,

                setup:
                  completeSetup,

                mode:
                  selectedMode,

                analysis:
                  currentAnalysis ||
                  existing?.analysis ||
                  null,

                savedAt:
                  Date.now(),
              })
            } catch (error) {
              console.error(
                'Could not save published scene:',
                error
              )
            }
          })()
      } else {
        setUserScenes(
          (current) =>
            current.filter(
              (scene) =>
                scene.id !==
                selectedScene.id
            )
        )

        deletePublishedSceneRecord(
          selectedScene.id
        ).catch(
          (error) =>
            console.error(
              'Could not remove published scene:',
              error
            )
        )
      }
    }

    setRecordingTakes(
      nextTakes
    )

    if (
      editingSetupFromRecording
    ) {
      let nextIndex = 0

      if (currentTurnId) {
        const matchedIndex =
          nextRecordingTurns.findIndex(
            (line) =>
              line.id ===
              currentTurnId
          )

        nextIndex =
          matchedIndex >= 0
            ? matchedIndex
            : Math.min(
              activeTurn,
              Math.max(
                0,
                nextRecordingTurns.length -
                1
              )
            )
      }

      setActiveTurn(
        nextIndex
      )

      const nextTurnId =
        nextRecordingTurns[
          nextIndex
        ]?.id

      setSegmentState(
        nextTurnId &&
          nextTakes[
          nextTurnId
          ]
          ? 'recorded'
          : 'preview'
      )
    } else {
      setActiveTurn(0)
      setSegmentState(
        'preview'
      )
    }

    setEditingSetupFromRecording(
      false
    )

    if (
      selectedMode === 'invite'
    ) {
      const assignedRole =
        inviteParticipantRole === 'host'
          ? 'person-1'
          : 'person-2'

      const myInviteTurns =
        (
          completeSetup.dialogue ||
          []
        ).filter(
          (line) =>
            line.role === assignedRole
        )

      if (!myInviteTurns.length) {
        try {
          const finishedRoom =
            await finishInviteParticipantRequest(
              inviteRoom.room_code,
              inviteRoom.participant_token
            )

          setInviteRoom(
            (current) => ({
              ...current,
              ...finishedRoom,
              participant_token:
                current?.participant_token,
              participant_role:
                current?.participant_role,
            })
          )

          setScreen(
            'inviteWaiting'
          )
        } catch (error) {
          console.error(error)

          setInviteError(
            language === 'ar'
              ? 'تعذّر بدء الغرفة.'
              : 'Could not start the room.'
          )
        }
      } else {
        setScreen(
          'voiceover'
        )
      }
    } else {
      setScreen(
        'voiceover'
      )
    }

    window.scrollTo({
      top: 0,
      behavior: 'smooth',
    })
  }

  const nextTurn = async () => {
    if (
      selectedMode === 'invite' &&
      inviteRoom?.room_code &&
      inviteRoom?.participant_token
    ) {
      const currentTurn =
        recordingTurns[
          activeTurn
        ]

      const currentTake =
        currentTurn
          ? recordingTakes[
              currentTurn.id
            ]
          : null

      if (
        !currentTurn ||
        !currentTake?.blob
      ) {
        setInviteTakeError(
          language === 'ar'
            ? 'اعتمدي التسجيل الحالي أولًا.'
            : 'Keep the current take first.'
        )

        return
      }

      try {
        setInviteTakeBusy(
          true
        )

        setInviteTakeError(
          ''
        )

        const updatedRoom =
          await uploadInviteTakeRequest(
            inviteRoom.room_code,
            inviteRoom.participant_token,
            currentTurn,
            currentTake
          )

        setInviteRoom(
          (current) => ({
            ...current,
            ...updatedRoom,
            participant_token:
              current?.participant_token,
            participant_role:
              current?.participant_role,
          })
        )

        if (
          activeTurn <
          recordingTurns.length - 1
        ) {
          const nextIndex =
            activeTurn + 1

          const nextTurnId =
            recordingTurns[
              nextIndex
            ]?.id

          setActiveTurn(
            nextIndex
          )

          setSegmentState(
            nextTurnId &&
              recordingTakes[
                nextTurnId
              ]
              ? 'recorded'
              : 'preview'
          )

          window.scrollTo({
            top: 0,
            behavior: 'smooth',
          })

          return
        }

        const finishedRoom =
          await finishInviteParticipantRequest(
            inviteRoom.room_code,
            inviteRoom.participant_token
          )

        setInviteRoom(
          (current) => ({
            ...current,
            ...finishedRoom,
            participant_token:
              current?.participant_token,
            participant_role:
              current?.participant_role,
          })
        )

        setScreen(
          'inviteWaiting'
        )

        window.scrollTo({
          top: 0,
          behavior: 'smooth',
        })
      } catch (error) {
        console.error(
          'Invite take sync failed:',
          error
        )

        setInviteTakeError(
          language === 'ar'
            ? 'تعذّر حفظ التسجيل في الغرفة. حاولي مرة أخرى.'
            : 'This take could not be saved to the room. Please try again.'
        )
      } finally {
        setInviteTakeBusy(
          false
        )
      }

      return
    }

    if (
      activeTurn <
      recordingTurns.length - 1
    ) {
      const nextIndex =
        activeTurn + 1

      const nextTurnId =
        recordingTurns[
          nextIndex
        ]?.id

      setActiveTurn(
        nextIndex
      )

      setSegmentState(
        nextTurnId &&
          recordingTakes[
            nextTurnId
          ]
          ? 'recorded'
          : 'preview'
      )

      return
    }

    setScreen('result')

    window.scrollTo({
      top: 0,
      behavior: 'smooth',
    })
  }

  const previousTurn = () => {
    if (activeTurn <= 0) {
      return
    }

    const previousIndex =
      activeTurn - 1

    const previousTurnId =
      recordingTurns[
        previousIndex
      ]?.id

    setActiveTurn(
      previousIndex
    )

    setSegmentState(
      previousTurnId &&
        recordingTakes[
        previousTurnId
        ]
        ? 'recorded'
        : 'preview'
    )

    window.scrollTo({
      top: 0,
      behavior: 'smooth',
    })
  }

  const editDialogueSetup =
    () => {
      setEditingSetupFromRecording(
        true
      )

      setScreen(
        'dialogueSetup'
      )

      window.scrollTo({
        top: 0,
        behavior: 'smooth',
      })
    }

  const handleUploadedVideo = async (
    file,
    speechLanguage = 'auto'
  ) => {
    if (!file) return

    const sceneId = `upload-${Date.now()}`

    const videoUrl = URL.createObjectURL(file)

    const title = file.name
      .replace(/\.[^/.]+$/, '')
      .trim()

    const newScene = {
      id: sceneId,

      title: title || 'Uploaded Scene',
      titleAr: title || 'مشهد مرفوع',

      category: 'Uploaded',
      categoryAr: 'مرفوع',

      mode: 'duo',
      characters: 2,

      community: false,
      trending: false,
      isUpload: true,
      speechLanguage,

      videoUrl,
      sourceFile: file,
    }

    try {
      setIsAnalyzing(true)
      setAnalysisError('')
      beginAnalysisProgress()

      const analysis =
        await analyzeFile(
          file,
          sceneId,
          speechLanguage
        )

      setAnalysisProgress(94)

      setAnalysisStage(
        language === 'ar'
          ? 'تجهيز الخلفية الصوتية...'
          : 'Preparing clean background audio...'
      )

      const mix =
        await prepareSceneForDub(
          file,
          sceneId
        )

      const preparedAnalysis = {
        ...analysis,
        mix,
      }

      finishAnalysisProgress()

      setSelectedScene(newScene)
      setSelectedMode('solo')

      setSceneAnalysis(
        preparedAnalysis
      )

      setAnalysisCache((current) => ({
        ...current,
        [sceneId]:
          preparedAnalysis,
      }))

      setTimeout(() => {
        setScreen('scene')

        window.scrollTo({
          top: 0,
          behavior: 'smooth',
        })

        resetAnalysisProgress()
      }, 350)
    } catch (error) {
      console.error(error)

      resetAnalysisProgress()

      setAnalysisError(
        language === 'ar'
          ? 'تعذّر تحليل الفيديو المرفوع.'
          : 'We could not analyze the uploaded video.'
      )
    } finally {
      setIsAnalyzing(false)
    }
  }

  const renameUploadedScene = (newTitle) => {
    const clean =
      newTitle.trim()

    if (
      !clean ||
      !selectedScene?.isUpload
    ) {
      return
    }

    setSelectedScene(
      (current) => ({
        ...current,
        title: clean,
        titleAr: clean,
      })
    )

    setUserScenes(
      (current) =>
        current.map(
          (scene) =>
            scene.id ===
              selectedScene.id
              ? {
                ...scene,
                title: clean,
                titleAr: clean,
              }
              : scene
        )
    )

    updatePublishedSceneRecord(
      selectedScene.id,
      {
        scene: {
          title: clean,
          titleAr: clean,
        },
      }
    ).catch(
      (error) =>
        console.error(
          'Could not persist renamed scene:',
          error
        )
    )
  }

  return (
    <main
      className={`app ${theme}`}
      dir={isArabic ? 'rtl' : 'ltr'}
    >
      <Header
        theme={theme}
        setTheme={setTheme}
        language={language}
        setLanguage={setLanguage}
        t={t}
        onLogoClick={goHome}
        onExploreClick={goHome}
        onCreateClick={() => setScreen('create')}
        onDuoClick={openDuoLibrary}
        onJoinRoomClick={() =>
          setJoinRoomModalOpen(true)
        }
        accountUser={accountUser}
        onAccountClick={() =>
          setScreen(
            accountUser
              ? 'profile'
              : 'auth'
          )
        }
      />

      {screen === 'home' && (
        <Home
          t={t}
          language={language}
          scenes={filteredScenes}
          search={search}
          setSearch={setSearch}
          libraryFilter={libraryFilter}
          setLibraryFilter={setLibraryFilter}
          onOpenScene={openScene}
          onCreate={() => setScreen('create')}
          onJoinRoom={() =>
            setJoinRoomModalOpen(true)
          }
          accountUser={accountUser}
        />
      )}

      {screen === 'scene' && (
        <ScenePage
          t={t}
          language={language}
          scene={selectedScene}
          analysis={currentAnalysis}
          selectedMode={selectedMode}
          setSelectedMode={setSelectedMode}
          onBack={goHome}
          onStart={
            selectedMode === 'invite'
              ? createInviteRoom
              : startVoiceOver
          }
          isAnalyzing={isAnalyzing}
          analysisError={analysisError}
          analysisProgress={analysisProgress}
          analysisStage={analysisStage}
          inviteBusy={inviteBusy}
          inviteError={inviteError}
          onRename={renameUploadedScene}
        />
      )}

      {screen === 'inviteRoom' && (
        <InviteRoomPage
          language={language}
          room={inviteRoom}
          loading={inviteBusy}
          error={inviteError}
          onBack={() => {
            const url =
              new URL(
                window.location.href
              )

            url.searchParams.delete(
              'room'
            )

            window.history.replaceState(
              {},
              '',
              url.toString()
            )

            setInviteRoom(null)
            setInviteError('')

            setScreen(
              selectedScene
                ? 'scene'
                : 'home'
            )
          }}
          onJoined={(joined) => {
            localStorage.setItem(
              `vox-room-token-${joined.room_code}`,
              joined.participant_token
            )

            localStorage.setItem(
              `vox-room-role-${joined.room_code}`,
              'guest'
            )

            setInviteParticipantRole(
              'guest'
            )

            setInviteRoom({
              ...joined,
              participant_role:
                'guest',
            })

            if (
              joined.scene_video_url
            ) {
              setSelectedScene({
                id:
                  joined.scene_id,
                title:
                  joined.scene_title,
                titleAr:
                  joined.scene_title_ar ||
                  joined.scene_title,
                category:
                  'Invite',
                categoryAr:
                  'دعوة',
                mode:
                  'duo',
                characters:
                  2,
                videoUrl:
                  joined.scene_video_url,
                isInviteRoom:
                  true,
              })
            }

            if (joined.analysis) {
              setSceneAnalysis(
                joined.analysis
              )
            }

            if (joined.setup) {
              setSceneSetup(
                joined.setup
              )
            }

            setSelectedMode(
              'invite'
            )
          }}
          onContinueToRoles={(room) => {
            if (
              room.scene_video_url
            ) {
              setSelectedScene({
                id:
                  room.scene_id,
                title:
                  room.scene_title,
                titleAr:
                  room.scene_title_ar ||
                  room.scene_title,
                category:
                  'Invite',
                categoryAr:
                  'دعوة',
                mode:
                  'duo',
                characters:
                  2,
                videoUrl:
                  room.scene_video_url,
                isInviteRoom:
                  true,
              })
            }

            if (room.analysis) {
              setSceneAnalysis(
                room.analysis
              )
            }

            setSelectedMode(
              'invite'
            )

            setScreen(
              'dialogueSetup'
            )
          }}
          onStartGuest={(room) => {
            setSceneSetup(
              room.setup
            )

            if (
              room.scene_video_url
            ) {
              setSelectedScene({
                id:
                  room.scene_id,
                title:
                  room.scene_title,
                titleAr:
                  room.scene_title_ar ||
                  room.scene_title,
                category:
                  'Invite',
                categoryAr:
                  'دعوة',
                mode:
                  'duo',
                characters:
                  2,
                videoUrl:
                  room.scene_video_url,
                isInviteRoom:
                  true,
              })
            }

            setSelectedMode(
              'invite'
            )

            setActiveTurn(0)
            setSegmentState(
              'preview'
            )

            setScreen(
              'voiceover'
            )
          }}
        />
      )}

      {screen === 'dialogueSetup' && (
        <DialogueSetup
          language={language}
          scene={selectedScene}
          mode={selectedMode}
          analysis={currentAnalysis}
          savedSetup={sceneSetup}
          roleNames={
            selectedMode === 'invite'
              ? {
                  person1:
                    inviteRoom?.host_name ||
                    'Host',
                  person2:
                    inviteRoom?.guest_name ||
                    'Guest',
                }
              : null
          }
          readOnly={
            selectedMode === 'invite' &&
            inviteParticipantRole !== 'host'
          }
          onBack={() =>
            selectedMode === 'invite'
              ? setScreen('inviteRoom')
              : setScreen('scene')
          }
          onContinue={approveDialogueSetup}
        />
      )}

      {screen === 'voiceover' && (
        <VoiceOverPage
          t={t}
          language={language}
          scene={selectedScene}
          setup={sceneSetup}
          turns={recordingTurns}
          activeTurn={activeTurn}
          segmentState={segmentState}
          setSegmentState={setSegmentState}
          recordingTakes={recordingTakes}
          setRecordingTakes={setRecordingTakes}
          onBack={editDialogueSetup}
          onPrevious={previousTurn}
          onNext={nextTurn}
          advanceBusy={inviteTakeBusy}
          advanceError={inviteTakeError}
          onBeforeRecord={ensureCreationCredit}
        />
      )}

      {screen === 'inviteWaiting' && (
        <InviteWaitingPage
          language={language}
          room={inviteRoom}
          participantRole={
            inviteParticipantRole
          }
          onRoomUpdate={(nextRoom) => {
            setInviteRoom(
              (current) => ({
                ...current,
                ...nextRoom,
                participant_token:
                  current?.participant_token,
                participant_role:
                  current?.participant_role,
              })
            )
          }}
          onBackToRoom={() =>
            setScreen(
              'inviteRoom'
            )
          }
        />
      )}

      {screen === 'result' && (
        <ResultPage
          t={t}
          scene={selectedScene}
          setup={sceneSetup}
          takes={recordingTakes}
          onBack={goHome}
          onRetry={() => {
            setRecordingTakes({})
            setActiveTurn(0)
            setSegmentState('preview')
            setScreen('voiceover')
          }}
        />
      )}


      {screen === 'auth' && (
        <AuthPage
          language={language}
          busy={accountBusy}
          error={accountError}
          onBack={goHome}
          onSubmit={handleAuth}
          onTerms={() => setScreen('terms')}
          onPrivacy={() => setScreen('privacy')}
        />
      )}

      {screen === 'terms' && (
        <PolicyPage
          language={language}
          type="terms"
          onBack={() => setScreen('auth')}
        />
      )}

      {screen === 'privacy' && (
        <PolicyPage
          language={language}
          type="privacy"
          onBack={() => setScreen('auth')}
        />
      )}

      {screen === 'profile' && (
        <ProfilePage
          language={language}
          user={accountUser}
          busy={accountBusy}
          error={accountError}
          onBack={goHome}
          onBuy={simulatePurchase}
          onLogout={logoutAccount}
          onTerms={() => setScreen('terms')}
          onPrivacy={() => setScreen('privacy')}
        />
      )}

      {joinRoomModalOpen && (
        <JoinRoomModal
          language={language}
          value={joinCode}
          onChange={setJoinCode}
          onClose={() =>
            setJoinRoomModalOpen(false)
          }
          onJoin={() => {
            if (!joinCode.trim()) return
            setJoinRoomModalOpen(false)
            joinRoomByCode(joinCode)
          }}
        />
      )}

      {paywallOpen && (
        <CreditsModal
          language={language}
          busy={accountBusy}
          onClose={() =>
            setPaywallOpen(false)
          }
          onBuy={simulatePurchase}
        />
      )}

      {screen === 'create' && (
        <CreatePage
          t={t}
          language={language}
          isAnalyzing={isAnalyzing}
          analysisError={analysisError}
          analysisProgress={analysisProgress}
          analysisStage={analysisStage}
          onBack={goHome}
          onUpload={handleUploadedVideo}
        />
      )}
    </main>
  )
}

function Header({
  theme,
  setTheme,
  language,
  setLanguage,
  t,
  onLogoClick,
  onExploreClick,
  onCreateClick,
  onDuoClick,
  onJoinRoomClick,
  accountUser,
  onAccountClick,
}) {
  return (
    <header className="navbar">
      <button
        type="button"
        className="brandButton"
        onClick={onLogoClick}
        aria-label="VOX home"
      >
        <span className="logo">VOX<span className="logoDot">.</span></span>
      </button>

      <div className="navSpacer" />

      <div className="navActions">
        <button
          type="button"
          className="accountButton"
          onClick={onAccountClick}
        >
          <span className="accountAvatar">
            {accountUser
              ? (accountUser.name || 'V')
                  .slice(0, 1)
                  .toUpperCase()
              : '○'}
          </span>

          <span className="accountButtonName">
            {accountUser
              ? language === 'ar'
                ? 'الملف الشخصي'
                : 'Profile'
              : language === 'ar'
                ? 'إنشاء حساب'
                : 'Create account'}
          </span>
        </button>

        <button
          type="button"
          className="languageToggle"
          onClick={() =>
            setLanguage((current) =>
              current === 'en'
                ? 'ar'
                : 'en'
            )
          }
        >
          {language === 'en'
            ? 'العربية'
            : 'EN'}
        </button>

        <button
          type="button"
          className="themeToggle"
          aria-label="Switch theme"
          onClick={() =>
            setTheme((current) =>
              current === 'dark'
                ? 'light'
                : 'dark'
            )
          }
        >
          <span
            className={`themeOption ${
              theme === 'light'
                ? 'active'
                : ''
            }`}
          >
            <span className="textGlyph">☀︎</span>
          </span>

          <span
            className={`themeOption ${
              theme === 'dark'
                ? 'active'
                : ''
            }`}
          >
            <span className="textGlyph">☾︎</span>
          </span>
        </button>
      </div>
    </header>
  )
}


function Home({
  t,
  language,
  scenes,
  onOpenScene,
  onCreate,
  onJoinRoom,
  accountUser,
}) {
  const demoScene =
    scenes?.[0] || null

  return (
    <>
      <section className="hero">
        <div className="heroContent">
          <span className="eyebrow">
            VOX · PERFORM ANY SCENE
          </span>

          <h1>
            {language === 'ar'
              ? 'مشهدك. بصوتك.'
              : 'Your scene. Your voice.'}
          </h1>

          <p>
            {language === 'ar'
              ? 'ارفع مشهدًا، اختر لقطاتك، سجّل الأداء وصدّر النتيجة. أول تجربة مجانًا.'
              : 'Upload a scene, choose your takes, perform it, and export. Your first creation is free.'}
          </p>

          <div className="heroActions heroPrimaryActions">
            <button
              type="button"
              className="primaryButton interactiveButton"
              onClick={onCreate}
            >
              {language === 'ar'
                ? 'إضافة مشهد'
                : 'Add a scene'}
              <span className="buttonArrow">
                {language === 'ar'
                  ? '←'
                  : '→'}
              </span>
            </button>

            <button
              type="button"
              className="secondaryButton interactiveButton"
              onClick={onJoinRoom}
            >
              {language === 'ar'
                ? 'انضم لغرفة'
                : 'Join room'}
            </button>
          </div>

          {accountUser && (
            <div className="homeCreditPill">
              <strong>
                {accountUser.remaining_creations}
              </strong>
              <span>
                {language === 'ar'
                  ? 'فيديو متبقي'
                  : 'creations remaining'}
              </span>
            </div>
          )}
        </div>

        <div className="heroVisual">
          <div className="visualTop">
            <span>UPLOAD</span>
            <span>PERFORM</span>
          </div>

          <div className="heroMovie">
            <div className="heroMovieContent">
              <span>YOUR SCENE</span>
              <strong>YOUR VOICE</strong>
            </div>
            <button className="heroPlayButton" aria-label="Play">
              <span className="heroPlayTriangle" />
            </button>
          </div>

          <Waveform />

          <div className="visualFooter">
            <span>EDIT</span>
            <span>RECORD</span>
            <span>EXPORT</span>
          </div>
        </div>
      </section>


      {demoScene && (
        <section className="demoSection">
          <div className="libraryHeader">
            <div>
              <span className="eyebrow">
                {language === 'ar'
                  ? 'فيديو تجريبي'
                  : 'DEMO'}
              </span>
              <h2>
                {language === 'ar'
                  ? 'شوف كيف تعمل VOX'
                  : 'See VOX in action'}
              </h2>
            </div>
          </div>

          <div className="demoSceneWrap">
            <SceneCard
              scene={demoScene}
              language={language}
              t={t}
              onOpen={() =>
                onOpenScene(demoScene)
              }
            />
          </div>
        </section>
      )}
    </>
  )
}

function SceneCard({
  scene,
  language,
  t,
  onOpen,
}) {
  const [duration, setDuration] =
    useState('--:--')

  const title =
    language === 'ar'
      ? scene.titleAr
      : scene.title

  const category =
    language === 'ar'
      ? scene.categoryAr
      : scene.category

  const handleMetadata = (event) => {
    const totalSeconds = Math.floor(
      event.currentTarget.duration
    )

    const minutes = Math.floor(
      totalSeconds / 60
    )

    const seconds = totalSeconds % 60

    setDuration(
      `${String(minutes).padStart(
        2,
        '0'
      )}:${String(seconds).padStart(
        2,
        '0'
      )}`
    )
  }

  return (
    <article className="sceneCard">
      <button
        className="sceneVisual sceneVideoVisual"
        onClick={onOpen}
      >
        <video
          className="scenePreviewVideo"
          src={scene.videoUrl}
          muted
          preload="metadata"
          onLoadedMetadata={
            handleMetadata
          }
        />

        <div className="sceneVideoOverlay" />

        <span className="sceneBadge">
          {scene.mode === 'duo'
            ? t.scene.duo
            : t.scene.solo}
        </span>

        <span className="scenePlay">
          ▶︎︎
        </span>

        <span className="sceneDuration">
          {duration}
        </span>
      </button>

      <div className="sceneInfo">
        <div className="sceneMeta">
          <span>{category}</span>

          {scene.community && (
            <span>
              {t.library.community}
            </span>
          )}
        </div>

        <h3>{title}</h3>

        <button
          className="textButton"
          onClick={onOpen}
        >
          {t.scene.open}

          <span>{language === 'ar' ? '←' : '→'}</span>        </button>
      </div>
    </article>
  )
}

function ScenePage({
  t,
  language,
  scene,
  analysis,
  selectedMode,
  setSelectedMode,
  onBack,
  onStart,
  isAnalyzing,
  analysisError,
  analysisProgress,
  analysisStage,
  inviteBusy = false,
  inviteError = '',
  onRename,
}) {
  const title =
    language === 'ar'
      ? scene.titleAr
      : scene.title

  const duration = analysis?.duration_seconds
    ? `${Math.floor(
      analysis.duration_seconds / 60
    )}:${String(
      Math.floor(
        analysis.duration_seconds % 60
      )
    ).padStart(2, '0')}`
    : '--:--'

  return (
    <section className="contentPage">
      <PageTop
        label={t.scene.original}
        onBack={onBack}
        backLabel={t.common.back}
      />

      <div className="scenePageIntro">
        <div>
          <span className="eyebrow">
            {t.scene.watchFirst}
          </span>

          {scene.isUpload ? (
            <EditableSceneTitle
              title={title}
              t={t}
              onSave={onRename}
            />
          ) : (
            <h1>{title}</h1>
          )}

          <p>
            {t.scene.previewDescription}
          </p>
        </div>

        <div className="sceneStats">
          <Stat
            label={t.scene.duration}
            value={duration}
          />

          <Stat
            label={t.scene.mode}
            value={
              scene.mode === 'duo'
                ? t.scene.duoReady
                : t.scene.solo
            }
          />
        </div>
      </div>

      <div className="mainVideoCard">
        <video
          src={scene.videoUrl}
          controls
          className="mainVideo"
        />

        <div className="videoNote">
          <span>
            {t.scene.previewNote}
          </span>
        </div>
      </div>

      {scene.mode === 'duo' && (
        <div className="modeSection">
          <span className="eyebrow">
            {t.scene.chooseMode}
          </span>

          <div className="modeCards">
            <button
              className={`modeCard ${selectedMode === 'solo'
                ? 'selected'
                : ''
                }`}
              onClick={() =>
                setSelectedMode('solo')
              }
            >
              <strong>
                {t.scene.solo}
              </strong>

              <span>
                {t.scene.soloDescription}
              </span>
            </button>

            <button
              className={`modeCard ${selectedMode === 'together'
                ? 'selected'
                : ''
                }`}
              onClick={() =>
                setSelectedMode('together')
              }
            >
              <strong>
                {t.scene.together}
              </strong>

              <span>
                {
                  t.scene
                    .togetherDescription
                }
              </span>
            </button>

            <button
              className={`modeCard ${selectedMode === 'invite'
                ? 'selected'
                : ''
                }`}
              onClick={() =>
                setSelectedMode('invite')
              }
            >
              <strong>
                {t.scene.invite}
              </strong>

              <span>
                {
                  t.scene
                    .inviteDescription
                }
              </span>
            </button>
          </div>
        </div>
      )}

      <div className="pageActionBar">
        <div>
          <span className="eyebrow">
            {t.scene.readyLabel}
          </span>

          <h3>
            {t.scene.readyTitle}
          </h3>

          {analysisError && (
            <p className="sceneAnalysisError">
              {analysisError}
            </p>
          )}

          {selectedMode === 'invite' &&
            inviteError && (
              <p className="sceneAnalysisError">
                {inviteError}
              </p>
            )}
        </div>

        <button
          className={`primaryButton ${
            inviteBusy
              ? 'inviteLaunchBusy'
              : ''
          }`}
          onClick={onStart}
          disabled={
            isAnalyzing ||
            inviteBusy
          }
        >
          {inviteBusy
            ? (
              <>
                <span className="inviteButtonSpinner" />
                {language === 'ar'
                  ? 'جارٍ إنشاء الغرفة...'
                  : 'Creating room...'}
              </>
            )
            : isAnalyzing
              ? t.scene.preparing
              : (
                <>
                  {t.scene.start}
                  <span>
                    {language === 'ar'
                      ? '←'
                      : '→'}
                  </span>
                </>
              )}
        </button>
      </div>

      {isAnalyzing && (
        <AnalysisProgress
          t={t}
          progress={analysisProgress}
          stage={analysisStage}
        />
      )}
    </section>
  )
}



function InviteWaitingPage({
  language,
  room,
  participantRole,
  onRoomUpdate,
  onBackToRoom,
}) {
  const [liveRoom, setLiveRoom] =
    useState(room)

  const [renderKickSent, setRenderKickSent] =
    useState(false)

  useEffect(() => {
    setLiveRoom(room)
  }, [room])

  useEffect(() => {
    if (!room?.room_code) return

    let cancelled = false

    const refresh = async () => {
      try {
        let next =
          await getInviteRoomRequest(
            room.room_code
          )

        const bothFinished =
          next.progress?.host?.finished &&
          next.progress?.guest?.finished

        const allReady =
          next.progress?.host?.ready &&
          next.progress?.guest?.ready

        if (
          bothFinished &&
          allReady &&
          !next.final_url &&
          next.render_status !== 'rendering' &&
          !renderKickSent
        ) {
          setRenderKickSent(
            true
          )

          try {
            next =
              await renderInviteIfReadyRequest(
                room.room_code
              )
          } catch {
            // Polling will expose render_error.
          }
        }

        if (!cancelled) {
          setLiveRoom(
            (current) => ({
              ...current,
              ...next,
              participant_token:
                current?.participant_token,
              participant_role:
                current?.participant_role,
            })
          )

          onRoomUpdate?.(
            next
          )
        }
      } catch (error) {
        console.warn(
          'Could not refresh invite room:',
          error
        )
      }
    }

    refresh()

    const timer =
      setInterval(
        refresh,
        1400
      )

    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [
    room?.room_code,
    renderKickSent,
  ])

  const host =
    liveRoom?.progress?.host ||
    {
      done: 0,
      total: 0,
      finished: false,
    }

  const guest =
    liveRoom?.progress?.guest ||
    {
      done: 0,
      total: 0,
      finished: false,
    }

  const bothFinished =
    host.finished &&
    guest.finished

  const finalUrl =
    liveRoom?.final_url || ''

  const saveFinalVideo =
    () => {
      if (!finalUrl) return

      const link =
        document.createElement(
          'a'
        )

      link.href =
        finalUrl

      link.download =
        `${liveRoom?.scene_title || 'vox-scene'}-duo.mp4`

      document.body.appendChild(
        link
      )

      link.click()
      link.remove()
    }

  const shareFinalVideo =
    async () => {
      if (!finalUrl) return

      try {
        const response =
          await fetch(
            finalUrl
          )

        const blob =
          await response.blob()

        const file =
          new File(
            [blob],
            `${liveRoom?.scene_title || 'vox-scene'}-duo.mp4`,
            {
              type: 'video/mp4',
            }
          )

        if (
          navigator.share &&
          navigator.canShare?.({
            files: [file],
          })
        ) {
          await navigator.share({
            files: [file],
            title:
              liveRoom?.scene_title ||
              'VOX scene',
          })

          return
        }
      } catch {
        // Fall through to save.
      }

      saveFinalVideo()
    }

  return (
    <section className="contentPage inviteWaitingPage">
      <PageTop
        label={
          language === 'ar'
            ? 'التسجيل المشترك'
            : 'Shared recording'
        }
        onBack={onBackToRoom}
        backLabel={
          language === 'ar'
            ? 'الغرفة'
            : 'Room'
        }
      />

      <div className="inviteWaitingHero">
        <span className="eyebrow">
          {finalUrl
            ? 'FINAL DUB'
            : language === 'ar'
              ? 'الغرفة مباشرة'
              : 'LIVE ROOM'}
        </span>

        <h1>
          {finalUrl
            ? language === 'ar'
              ? 'الفيديو جاهز للجميع.'
              : 'Your shared dub is ready.'
            : bothFinished
              ? language === 'ar'
                ? 'اكتملت التسجيلات.'
                : 'Everyone is done.'
              : language === 'ar'
                ? 'بانتظار اكتمال الطرفين.'
                : 'Waiting for both performers.'}
        </h1>

        <p>
          {finalUrl
            ? language === 'ar'
              ? 'تم دمج صوت الطرفين، وأي جزء محدد كـ Original بقي بصوته الأصلي.'
              : 'Both voices are mixed in, while every line assigned to Original keeps the original performance.'
            : bothFinished
              ? language === 'ar'
                ? 'يتم الآن بناء فيديو واحد للطرفين.'
                : 'Building one shared final video now.'
              : language === 'ar'
                ? 'كل طرف يسجل التيكات المخصصة له. الفيديو النهائي لن يُنشأ حتى ينتهي الجميع.'
                : 'Each person records only their assigned takes. The final video will not be created until everyone is finished.'}
        </p>
      </div>

      <div className="inviteProgressGrid">
        <InviteProgressCard
          name={
            liveRoom?.host_name ||
            'Host'
          }
          label={
            language === 'ar'
              ? 'المضيف'
              : 'Host'
          }
          progress={host}
          isYou={
            participantRole ===
            'host'
          }
          language={language}
        />

        <InviteProgressCard
          name={
            liveRoom?.guest_name ||
            'Guest'
          }
          label={
            language === 'ar'
              ? 'الضيف'
              : 'Guest'
          }
          progress={guest}
          isYou={
            participantRole ===
            'guest'
          }
          language={language}
        />
      </div>

      {liveRoom?.render_status === 'rendering' &&
        !finalUrl && (
          <div className="sharedRenderStatus">
            <div className="finalRenderPulse" />

            <strong>
              {language === 'ar'
                ? 'جارٍ دمج أصواتكم...'
                : 'Mixing both performances...'}
            </strong>

            <span>
              {language === 'ar'
                ? 'ستظهر النتيجة هنا تلقائيًا على الجهازين.'
                : 'The result will appear here automatically on both devices.'}
            </span>
          </div>
        )}

      {liveRoom?.render_status === 'error' &&
        !finalUrl && (
          <div className="sharedRenderError">
            <strong>
              {language === 'ar'
                ? 'تعذّر إنشاء الفيديو النهائي.'
                : 'The final dub could not be created.'}
            </strong>

            <span>
              {liveRoom.render_error}
            </span>
          </div>
        )}

      {finalUrl && (
        <>
          <div className="finalVideoCard inviteFinalVideo">
            <video
              src={finalUrl}
              controls
              autoPlay
              playsInline
              className="mainVideo"
            />

            <div className="finalMixBadge">
              SHARED FINAL DUB
            </div>
          </div>

          <div className="resultActions">
            <button
              className="secondaryWideButton"
              onClick={
                saveFinalVideo
              }
            >
              ↓{' '}
              {language === 'ar'
                ? 'حفظ'
                : 'Save'}
            </button>

            <button
              className="primaryWideButton"
              onClick={
                shareFinalVideo
              }
            >
              ↗{' '}
              {language === 'ar'
                ? 'مشاركة'
                : 'Share'}
            </button>
          </div>
        </>
      )}
    </section>
  )
}


function InviteProgressCard({
  name,
  label,
  progress,
  isYou,
  language,
}) {
  const percent =
    progress.total > 0
      ? Math.round(
          (
            progress.done /
            progress.total
          ) *
          100
        )
      : 100

  return (
    <article className="inviteProgressCard">
      <div className="inviteProgressTop">
        <div>
          <span>
            {label}
            {isYou
              ? language === 'ar'
                ? ' · أنت'
                : ' · You'
              : ''}
          </span>

          <strong>
            {name}
          </strong>
        </div>

        <b
          className={
            progress.finished
              ? 'complete'
              : ''
          }
        >
          {progress.finished
            ? '✓'
            : `${progress.done}/${progress.total}`}
        </b>
      </div>

      <div className="inviteProgressTrack">
        <span
          style={{
            width:
              `${percent}%`,
          }}
        />
      </div>

      <p>
        {progress.finished
          ? language === 'ar'
            ? 'اكتملت كل التيكات.'
            : 'All assigned takes are complete.'
          : language === 'ar'
            ? `${progress.total - progress.done} تيك متبقي`
            : `${Math.max(
                0,
                progress.total -
                progress.done
              )} take(s) remaining`}
      </p>
    </article>
  )
}


function InviteRoomPage({
  language,
  room,
  loading,
  error,
  onBack,
  onJoined,
  onContinueToRoles,
  onStartGuest,
}) {
  const [displayName, setDisplayName] =
    useState('')

  const [joining, setJoining] =
    useState(false)

  const [joinError, setJoinError] =
    useState('')

  const [copied, setCopied] =
    useState(false)

  const [liveRoom, setLiveRoom] =
    useState(room)

  const autoStartedRef =
    useRef(false)

  useEffect(() => {
    setLiveRoom(room)
  }, [room])

  useEffect(() => {
    if (
      !autoStartedRef.current &&
      liveRoom?.participant_role === 'guest' &&
      liveRoom?.setup_ready &&
      liveRoom?.setup
    ) {
      autoStartedRef.current = true

      onStartGuest?.(
        liveRoom
      )
    }
  }, [
    liveRoom?.setup_ready,
    liveRoom?.participant_role,
  ])

  useEffect(() => {
    if (!room?.room_code) return

    let cancelled = false

    const refresh = async () => {
      try {
        const next =
          await getInviteRoomRequest(
            room.room_code
          )

        if (!cancelled) {
          setLiveRoom(
            (current) => ({
              ...current,
              ...next,
              participant_token:
                current?.participant_token,
              participant_role:
                current?.participant_role,
            })
          )
        }
      } catch {
        // Keep last known state.
      }
    }

    refresh()

    const timer =
      setInterval(
        refresh,
        600
      )

    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [room?.room_code])

  const inviteUrl =
    liveRoom?.room_code
      ? `${window.location.origin}${window.location.pathname}?room=${encodeURIComponent(liveRoom.room_code)}`
      : ''

  const alreadyParticipant =
    Boolean(
      liveRoom?.participant_token
    )

  const isHost =
    liveRoom?.participant_role ===
    'host'

  const isGuest =
    liveRoom?.participant_role ===
    'guest'

  const copyInvite = async () => {
    if (!inviteUrl) return

    try {
      await navigator.clipboard.writeText(
        inviteUrl
      )

      setCopied(true)

      setTimeout(() => {
        setCopied(false)
      }, 1600)
    } catch {
      window.prompt(
        language === 'ar'
          ? 'انسخي رابط الدعوة:'
          : 'Copy invite link:',
        inviteUrl
      )
    }
  }

  const shareInvite = async () => {
    if (!inviteUrl) return

    if (navigator.share) {
      try {
        await navigator.share({
          title:
            language === 'ar'
              ? 'دعوة VOX'
              : 'VOX invite',
          text:
            language === 'ar'
              ? 'انضم للمشهد معي'
              : 'Join this VOX scene with me',
          url: inviteUrl,
        })

        return
      } catch {
        // Ignore cancel.
      }
    }

    await copyInvite()
  }

  const joinRoom = async () => {
    const clean =
      displayName.trim()

    if (!clean) {
      setJoinError(
        language === 'ar'
          ? 'اكتبي اسمك أولًا.'
          : 'Enter your name first.'
      )
      return
    }

    try {
      setJoining(true)
      setJoinError('')

      const joined =
        await joinInviteRoomRequest(
          liveRoom.room_code,
          clean
        )

      onJoined?.(joined)
      setLiveRoom(joined)

      try {
        const latest =
          await getInviteRoomRequest(
            joined.room_code
          )

        setLiveRoom(
          (current) => ({
            ...current,
            ...latest,
            participant_token:
              current?.participant_token,
            participant_role:
              current?.participant_role,
          })
        )
      } catch {
        // Normal polling will retry.
      }
    } catch (joinFailure) {
      setJoinError(
        joinFailure.message ||
        'Could not join room.'
      )
    } finally {
      setJoining(false)
    }
  }

  return (
    <section className="contentPage inviteRoomPage">
      <PageTop
        label={
          language === 'ar'
            ? 'غرفة الدعوة'
            : 'Invite room'
        }
        onBack={onBack}
        backLabel={
          language === 'ar'
            ? 'رجوع'
            : 'Back'
        }
      />

      {loading && !liveRoom ? (
        <div className="inviteRoomState">
          <span className="eyebrow">
            VOX ROOM
          </span>

          <h1>
            {language === 'ar'
              ? 'جارٍ فتح الغرفة...'
              : 'Opening room...'}
          </h1>
        </div>
      ) : error && !liveRoom ? (
        <div className="inviteRoomState">
          <span className="eyebrow">
            VOX ROOM
          </span>

          <h1>
            {language === 'ar'
              ? 'تعذّر فتح الغرفة'
              : 'Could not open room'}
          </h1>

          <p>{error}</p>
        </div>
      ) : liveRoom ? (
        <div className="inviteRoomGrid">
          <div className="inviteRoomMain">
            <span className="eyebrow">
              {language === 'ar'
                ? 'مشهد مشترك'
                : 'Shared scene'}
            </span>

            <h1>
              {language === 'ar'
                ? liveRoom.scene_title_ar ||
                  liveRoom.scene_title
                : liveRoom.scene_title ||
                  liveRoom.scene_title_ar}
            </h1>

            <p className="inviteRoomLead">
              {alreadyParticipant
                ? language === 'ar'
                  ? 'الغرفة جاهزة. أرسلي الرابط للشخص الثاني.'
                  : 'Your room is ready. Send the link to the other person.'
                : language === 'ar'
                  ? 'تمت دعوتك لهذا المشهد. اكتبي اسمك للانضمام.'
                  : 'You were invited to this scene. Enter your name to join.'}
            </p>

            {!alreadyParticipant ? (
              <div className="joinRoomBox">
                <label>
                  <span>
                    {language === 'ar'
                      ? 'اسمك'
                      : 'Your name'}
                  </span>

                  <input
                    value={displayName}
                    maxLength={40}
                    onChange={(event) =>
                      setDisplayName(
                        event.target.value
                      )
                    }
                    onKeyDown={(event) => {
                      if (
                        event.key === 'Enter'
                      ) {
                        joinRoom()
                      }
                    }}
                    placeholder={
                      language === 'ar'
                        ? 'مثال: Nora'
                        : 'e.g. Nora'
                    }
                  />
                </label>

                <button
                  className="primaryWideButton"
                  disabled={joining}
                  onClick={joinRoom}
                >
                  {joining
                    ? language === 'ar'
                      ? 'جارٍ الانضمام...'
                      : 'Joining...'
                    : language === 'ar'
                      ? 'انضم للمشهد'
                      : 'Join scene'}
                </button>

                {joinError && (
                  <p className="inviteError">
                    {joinError}
                  </p>
                )}
              </div>
            ) : isHost ? (
              <>
                <div className="roomCodeCard">
                  <span>
                    {language === 'ar'
                      ? 'كود الغرفة'
                      : 'ROOM CODE'}
                  </span>

                  <strong>
                    {liveRoom.room_code}
                  </strong>
                </div>

                <div className="inviteButtons">
                  <button
                    className="primaryButton"
                    onClick={shareInvite}
                  >
                    {language === 'ar'
                      ? 'مشاركة الدعوة'
                      : 'Share invite'}
                  </button>

                  <button
                    className="secondaryButton"
                    onClick={copyInvite}
                  >
                    {copied
                      ? language === 'ar'
                        ? '✓ تم النسخ'
                        : '✓ Copied'
                      : language === 'ar'
                        ? 'نسخ الرابط'
                        : 'Copy link'}
                  </button>
                </div>
              </>
            ) : (
              <div className="guestConnectedCard">
                <span className="eyebrow">
                  {language === 'ar'
                    ? 'متصل بالغرفة'
                    : 'CONNECTED'}
                </span>

                <h3>
                  {language === 'ar'
                    ? `أنت الآن متصل مع ${liveRoom.host_name || 'Host'}`
                    : `You're connected with ${liveRoom.host_name || 'Host'}`}
                </h3>

                <p>
                  {liveRoom.setup_ready
                    ? language === 'ar'
                      ? 'بدأ المضيف الجلسة. سيتم نقلك تلقائيًا إلى التيكات المخصصة لك.'
                      : 'The host started the session. Opening your assigned takes automatically...'
                    : language === 'ar'
                      ? 'بانتظار المضيف ليبدأ الجلسة.'
                      : 'Waiting for the host to start the session.'}
                </p>
              </div>
            )}

            {alreadyParticipant && (
              <div className="inviteRoomContinue">
                {isHost ? (
                  <>
                    <button
                      className="primaryWideButton"
                      disabled={
                        !liveRoom.guest_name ||
                        !liveRoom.scene_video_url
                      }
                      onClick={() =>
                        onContinueToRoles?.(
                          liveRoom
                        )
                      }
                    >
                      {language === 'ar'
                        ? 'متابعة إلى توزيع الأدوار'
                        : 'Continue to role setup'}
                    </button>

                    {!liveRoom.guest_name && (
                      <p>
                        {language === 'ar'
                          ? 'ينتظر دخول الضيف قبل توزيع الأدوار.'
                          : 'Waiting for the guest to join before role setup.'}
                      </p>
                    )}
                  </>
) : isGuest ? (
                  <div className="inviteWaitingBox">
                    <strong>
                      {liveRoom.setup_ready
                        ? language === 'ar'
                          ? 'بدأ التسجيل'
                          : 'Recording started'
                        : language === 'ar'
                          ? 'بانتظار المضيف'
                          : 'Waiting for the host'}
                    </strong>

                    <span>
                      {liveRoom.setup_ready
                        ? language === 'ar'
                          ? 'سيتم نقلك تلقائيًا إلى التيكات المخصصة لك.'
                          : 'Opening your assigned takes automatically...'
                        : language === 'ar'
                          ? 'عندما يعتمد المضيف الأدوار، سيبدأ الجميع تلقائيًا.'
                          : 'When the host confirms the roles, everyone starts automatically.'}
                    </span>
                  </div>
                ) : null}
              </div>
            )}
          </div>

          <aside className="inviteParticipantsCard">
            <span className="eyebrow">
              {language === 'ar'
                ? 'المشاركون'
                : 'Participants'}
            </span>

            <div className="participantRow">
              <div>
                <strong>
                  {liveRoom.host_name ||
                    (language === 'ar'
                      ? 'المضيف'
                      : 'Host')}
                </strong>

                <span>
                  {language === 'ar'
                    ? 'المضيف'
                    : 'Host'}
                </span>
              </div>

              <i className="participantDot ready" />
            </div>

            <div className="participantRow">
              <div>
                <strong>
                  {liveRoom.guest_name ||
                    (language === 'ar'
                      ? 'بانتظار الضيف...'
                      : 'Waiting for guest...')}
                </strong>

                <span>
                  {language === 'ar'
                    ? 'الضيف'
                    : 'Guest'}
                </span>
              </div>

              <i
                className={`participantDot ${
                  liveRoom.guest_name
                    ? 'ready'
                    : ''
                }`}
              />
            </div>

            <p className="inviteRoomHint">
              {liveRoom.guest_name
                ? language === 'ar'
                  ? 'الطرفان داخل نفس الغرفة الآن.'
                  : 'Both participants are now in the same room.'
                : language === 'ar'
                  ? 'تتحدث الحالة تلقائيًا عند دخول الشخص الثاني.'
                  : 'This updates automatically when the other person joins.'}
            </p>
          </aside>
        </div>
      ) : null}
    </section>
  )
}

function VoiceOverPage({
  t,
  language,
  scene,
  setup,
  turns,
  activeTurn,
  segmentState,
  setSegmentState,
  recordingTakes,
  setRecordingTakes,
  onBack,
  onPrevious,
  onNext,
  advanceBusy = false,
  advanceError = '',
  onBeforeRecord,
}) {
  const videoRef =
    useRef(null)

  const mediaRecorderRef =
    useRef(null)

  const micStreamRef =
    useRef(null)

  const audioContextRef =
    useRef(null)

  const analyserRef =
    useRef(null)

  const animationFrameRef =
    useRef(null)

  const recordingStartRef =
    useRef(0)

  const recordedChunksRef =
    useRef([])

  const liveWaveRef =
    useRef([])

  const takeAudioRef =
    useRef(null)

  const previewBackgroundRef =
    useRef(null)

  const [
    videoTime,
    setVideoTime,
  ] = useState(0)

  const [
    recordingError,
    setRecordingError,
  ] = useState('')

  const [
    liveUserWave,
    setLiveUserWave,
  ] = useState([])

  const [
    isRecording,
    setIsRecording,
  ] = useState(false)

  const [
    originalPcmWave,
    setOriginalPcmWave,
  ] = useState([])

  const turn =
    turns[activeTurn]

  const currentTake =
    turn
      ? recordingTakes[
      turn.id
      ]
      : null

  const turnDuration =
    turn
      ? Math.max(
        0.1,
        turn.end -
        turn.start
      )
      : 0


  /*
    Recording handles:
    We intentionally capture a little before and
    after the dialogue line. This prevents the first
    and last syllables from being chopped and makes
    adjacent takes sound much less "cut together".
  */
  const takeLeadIn =
    turn
      ? Math.min(
        0.32,
        Math.max(
          0,
          turn.start
        )
      )
      : 0

  const takeTail =
    turn
      ? Math.min(
        0.42,
        Math.max(
          0,
          (setup?.duration ||
            turn.end +
            0.42) -
          turn.end
        )
      )
      : 0

  const captureStart =
    turn
      ? Math.max(
        0,
        turn.start -
        takeLeadIn
      )
      : 0

  const captureEnd =
    turn
      ? Math.min(
        setup?.duration ||
        turn.end +
        takeTail,
        turn.end +
        takeTail
      )
      : 0

  const captureDuration =
    Math.max(
      0.1,
      captureEnd -
      captureStart
    )

  const segmentProgress =
    turn &&
      turnDuration > 0
      ? Math.min(
        1,
        Math.max(
          0,
          (videoTime -
            turn.start) /
          turnDuration
        )
      )
      : 0

  useEffect(() => {
    let cancelled =
      false

    async function loadOriginalWave() {
      if (
        !turn ||
        !scene?.videoUrl
      ) {
        setOriginalPcmWave(
          []
        )

        return
      }

      try {
        const wave =
          await extractRealSegmentWaveform(
            scene.videoUrl,
            turn.start,
            turn.end,
            320
          )

        if (!cancelled) {
          setOriginalPcmWave(
            wave
          )
        }
      } catch (error) {
        console.warn(
          'Falling back to backend waveform:',
          error
        )

        if (!cancelled) {
          setOriginalPcmWave(
            []
          )
        }
      }
    }

    loadOriginalWave()

    return () => {
      cancelled = true
    }
  }, [
    scene?.videoUrl,
    turn?.id,
    turn?.start,
    turn?.end,
  ])

  useEffect(() => {
    setVideoTime(
      turn?.start || 0
    )

    setLiveUserWave([])

    return () => {
      takeAudioRef.current?.pause()
      previewBackgroundRef.current?.pause()
    }
  }, [turn?.id])

  if (!turn) {
    return (
      <section className="contentPage">
        <PageTop
          label={
            t.recording.label
          }
          onBack={onBack}
          backLabel={
            t.common.back
          }
        />

        <div className="emptyState">
          <h2>
            {
              t.recording
                .noLines
            }
          </h2>
        </div>
      </section>
    )
  }

  const progress =
    ((activeTurn + 1) /
      turns.length) *
    100

  const roleLabel =
    turn.role ===
      'person-2'
      ? t.dialogue.person2
      : turn.role ===
        'person-1'
        ? t.dialogue.person1
        : t.dialogue.me

  const fallbackOriginalWave =
    normalizeWaveform(
      sliceWaveform(
        setup?.waveform ||
        [],
        turn.start,
        turn.end,
        setup?.duration || 0
      ),
      320
    )

  const turnWaveform =
    originalPcmWave.length
      ? originalPcmWave
      : fallbackOriginalWave

  const savedUserWave =
    currentTake?.waveform
      ?.length
      ? resampleWaveform(
        currentTake.waveform,
        320
      )
      : []

  const displayedUserWave =
    isRecording
      ? resampleWaveform(
        liveUserWave,
        320
      )
      : savedUserWave

  const waveformProgress =
    isRecording
      ? segmentProgress
      : currentTake
        ? 1
        : 0

  const stopTakePreview =
    () => {
      if (
        takeAudioRef.current
      ) {
        takeAudioRef.current.pause()
        takeAudioRef.current.currentTime =
          0
      }

      if (
        previewBackgroundRef.current
      ) {
        previewBackgroundRef.current.pause()
      }

      const video =
        videoRef.current

      if (video) {
        video.pause()
        video.muted = false
        video.volume = 1
      }
    }

  const cleanUpMic =
    () => {
      if (
        animationFrameRef.current
      ) {
        cancelAnimationFrame(
          animationFrameRef.current
        )

        animationFrameRef.current =
          null
      }

      if (
        audioContextRef.current
      ) {
        audioContextRef.current
          .close()
          .catch(() => { })

        audioContextRef.current =
          null
      }

      if (
        micStreamRef.current
      ) {
        micStreamRef.current
          .getTracks()
          .forEach(
            (track) =>
              track.stop()
          )

        micStreamRef.current =
          null
      }

      analyserRef.current =
        null
    }

  const stopRecording =
    () => {
      const recorder =
        mediaRecorderRef.current

      if (
        recorder &&
        recorder.state !==
        'inactive'
      ) {
        recorder.stop()
      }

      const video =
        videoRef.current

      if (video) {
        video.pause()
        video.volume = 1
      }
    }

  const playCurrentSegment =
    async ({
      quiet = false,
    } = {}) => {
      stopTakePreview()

      const video =
        videoRef.current

      if (!video) return

      video.muted = false
      video.currentTime =
        Math.max(
          0,
          turn.start
        )

      video.volume =
        quiet ? 0.16 : 1

      setVideoTime(
        turn.start
      )

      try {
        await video.play()
      } catch {
        // Browser playback can be blocked.
      }
    }


  const playRecordingReference =
    async () => {
      stopTakePreview()

      const video =
        videoRef.current

      if (!video) return

      video.muted = false

      video.currentTime =
        captureStart

      /*
        The reference remains audible but low.
        We start slightly before the line, giving the
        performer a natural visual/audio cue without
        a 3-2-1 countdown.
      */
      video.volume = 0.14

      setVideoTime(
        captureStart
      )

      try {
        await video.play()
      } catch {
        // Browser playback can be blocked.
      }
    }

  const captureWaveformFrame =
    () => {
      const analyser =
        analyserRef.current

      if (!analyser) return

      const data =
        new Float32Array(
          analyser.fftSize
        )

      analyser.getFloatTimeDomainData(
        data
      )

      let sumSquares = 0
      let peak = 0

      for (
        let index = 0;
        index <
        data.length;
        index += 1
      ) {
        const sample =
          Math.abs(
            data[index]
          )

        sumSquares +=
          sample * sample

        peak = Math.max(
          peak,
          sample
        )
      }

      const rms =
        Math.sqrt(
          sumSquares /
          Math.max(
            1,
            data.length
          )
        )

      const combinedLevel =
        rms * 0.72 +
        peak * 0.28

      const db =
        combinedLevel > 0
          ? 20 *
          Math.log10(
            combinedLevel
          )
          : -100

      const noiseGateDb =
        -48

      const loudDb =
        -10

      const level =
        db <= noiseGateDb
          ? 0
          : Math.min(
            1,
            Math.max(
              0,
              (db -
                noiseGateDb) /
              (loudDb -
                noiseGateDb)
            )
          )

      const shapedLevel =
        level > 0
          ? Math.pow(
            level,
            0.82
          )
          : 0

      const elapsed =
        (performance.now() -
          recordingStartRef.current) /
        1000

      const slotCount =
        320

      const slot =
        Math.min(
          slotCount - 1,
          Math.max(
            0,
            Math.floor(
              (elapsed /
                captureDuration) *
              slotCount
            )
          )
        )

      const next = [
        ...liveWaveRef.current,
      ]

      next[slot] =
        Math.max(
          next[slot] || 0,
          shapedLevel
        )

      liveWaveRef.current =
        next

      setLiveUserWave(
        [...next]
      )

      animationFrameRef.current =
        requestAnimationFrame(
          captureWaveformFrame
        )
    }

  const startRealRecording =
    async () => {
      setRecordingError('')

      if (onBeforeRecord) {
        const allowed =
          await onBeforeRecord()

        if (!allowed) {
          return
        }
      }

      if (
        !navigator
          .mediaDevices
          ?.getUserMedia
      ) {
        setRecordingError(
          language === 'ar'
            ? 'المتصفح لا يدعم التسجيل من الميكروفون.'
            : 'Microphone recording is not supported in this browser.'
        )

        return
      }

      stopTakePreview()

      try {
        const stream =
          await navigator
            .mediaDevices
            .getUserMedia({
              audio: {
                echoCancellation:
                  true,
                noiseSuppression:
                  false,
                autoGainControl:
                  false,
              },
            })

        micStreamRef.current =
          stream

        const AudioContext =
          window.AudioContext ||
          window.webkitAudioContext

        const audioContext =
          new AudioContext()

        audioContextRef.current =
          audioContext

        const source =
          audioContext
            .createMediaStreamSource(
              stream
            )

        const analyser =
          audioContext
            .createAnalyser()

        analyser.fftSize =
          512

        analyser.smoothingTimeConstant =
          0.45

        source.connect(
          analyser
        )

        analyserRef.current =
          analyser

        const preferredType =
          MediaRecorder
            .isTypeSupported(
              'audio/webm;codecs=opus'
            )
            ? 'audio/webm;codecs=opus'
            : MediaRecorder
              .isTypeSupported(
                'audio/webm'
              )
              ? 'audio/webm'
              : ''

        const recorder =
          preferredType
            ? new MediaRecorder(
              stream,
              {
                mimeType:
                  preferredType,
                audioBitsPerSecond:
                  128000,
              }
            )
            : new MediaRecorder(
              stream
            )

        mediaRecorderRef.current =
          recorder

        recordedChunksRef.current =
          []

        liveWaveRef.current =
          Array(320).fill(0)

        setLiveUserWave(
          Array(320).fill(0)
        )

        recorder.ondataavailable =
          (event) => {
            if (
              event.data &&
              event.data.size >
              0
            ) {
              recordedChunksRef.current.push(
                event.data
              )
            }
          }

        recorder.onstop =
          () => {
            const chunkType =
              recordedChunksRef
                .current[0]
                ?.type ||
              recorder.mimeType ||
              'audio/webm'

            const blob =
              new Blob(
                recordedChunksRef.current,
                {
                  type:
                    chunkType,
                }
              )

            const oldTake =
              recordingTakes[
              turn.id
              ]

            if (
              oldTake?.url
            ) {
              URL.revokeObjectURL(
                oldTake.url
              )
            }

            const url =
              URL.createObjectURL(
                blob
              )

            setRecordingTakes(
              (current) => ({
                ...current,

                [turn.id]: {
                  blob,
                  url,

                  waveform: [
                    ...liveWaveRef.current,
                  ],

                  duration:
                    captureDuration,

                  start:
                    captureStart,

                  end:
                    captureEnd,

                  lineStart:
                    turn.start,

                  lineEnd:
                    turn.end,

                  leadIn:
                    takeLeadIn,

                  tail:
                    takeTail,

                  role:
                    turn.role,

                  text:
                    turn.text,

                  offsetMs:
                    0,
                },
              })
            )

            cleanUpMic()

            setIsRecording(
              false
            )

            setSegmentState(
              'recorded'
            )
          }

        recorder.start(100)

        recordingStartRef.current =
          performance.now()

        setIsRecording(true)

        setSegmentState(
          'recording'
        )

        animationFrameRef.current =
          requestAnimationFrame(
            captureWaveformFrame
          )

        /*
          No countdown.
          Recording and reference video start together.
        */
        await playRecordingReference()
      } catch (error) {
        console.error(error)

        cleanUpMic()

        setIsRecording(false)

        setSegmentState(
          'preview'
        )

        setRecordingError(
          language === 'ar'
            ? 'تعذّر الوصول إلى الميكروفون.'
            : 'Microphone access was not available.'
        )
      }
    }

  const playMyTake =
    async () => {
      if (
        !currentTake?.url
      ) {
        return
      }

      stopTakePreview()

      const video =
        videoRef.current

      if (!video) return

      try {
        video.currentTime =
          currentTake.start ??
          captureStart

        video.muted = true
        video.volume = 0

        setVideoTime(
          currentTake.start ??
          captureStart
        )

        const takeAudio =
          new Audio(
            currentTake.url
          )

        takeAudio.preload =
          'auto'

        takeAudio.volume =
          1

        takeAudioRef.current =
          takeAudio

        let backgroundAudio =
          null

        if (
          setup?.mix
            ?.background_url
        ) {
          backgroundAudio =
            new Audio(
              setup.mix
                .background_url
            )

          backgroundAudio.preload =
            'auto'

          backgroundAudio.volume =
            1

          backgroundAudio.currentTime =
            currentTake.start ??
            captureStart

          previewBackgroundRef.current =
            backgroundAudio
        }

        const finishPreview =
          () => {
            stopTakePreview()

            video.currentTime =
              currentTake.end ??
              captureEnd

            setVideoTime(
              currentTake.end ??
              captureEnd
            )
          }

        takeAudio.onended =
          finishPreview

        await Promise.all([
          video.play(),
          takeAudio.play(),
          backgroundAudio
            ? backgroundAudio.play()
            : Promise.resolve(),
        ])
      } catch (error) {
        console.error(
          'Could not preview take:',
          error
        )

        stopTakePreview()

        setRecordingError(
          language === 'ar'
            ? 'تعذّر تشغيل التسجيل.'
            : 'The recorded take could not be played.'
        )
      }
    }

  const retryTake =
    () => {
      stopTakePreview()

      const take =
        recordingTakes[
        turn.id
        ]

      if (take?.url) {
        URL.revokeObjectURL(
          take.url
        )
      }

      setRecordingTakes(
        (current) => {
          const next = {
            ...current,
          }

          delete next[
            turn.id
          ]

          return next
        }
      )

      setLiveUserWave([])

      setVideoTime(
        turn.start
      )

      setSegmentState(
        'preview'
      )
    }

  const handleTimeUpdate =
    (event) => {
      const video =
        event.currentTarget

      const current =
        video.currentTime

      setVideoTime(
        current
      )

      const stopAt =
        isRecording
          ? captureEnd
          : turn.end

      if (
        current >=
        stopAt
      ) {
        video.pause()

        video.currentTime =
          stopAt

        setVideoTime(
          stopAt
        )

        if (
          isRecording
        ) {
          stopRecording()
        } else {
          video.volume =
            1
        }
      }
    }

  return (
    <section className="contentPage recordingPage">
      <PageTop
        label={`${t.recording.part} ${activeTurn + 1
          } / ${turns.length
          }`}
        onBack={() => {
          if (
            isRecording
          ) {
            stopRecording()
          }

          stopTakePreview()
          onBack()
        }}
        backLabel={
          t.common.back
        }
      />

      <div className="progressTrack">
        <span
          style={{
            width:
              `${progress}%`,
          }}
        />
      </div>

      <div className="recordingHeader">
        <span className="eyebrow">
          {roleLabel}
        </span>

        <h1>
          {
            t.recording
              .listenThenPerform
          }
        </h1>
      </div>

      <div className="recordingLayout">
        <div className="recordingVideoPanel">
          <video
            ref={videoRef}
            src={
              scene.videoUrl
            }
            controls={
              !isRecording
            }
            className="recordingVideo"
            onTimeUpdate={
              handleTimeUpdate
            }
          />
        </div>

        <div className="recordingControlPanel">
          <div className="recordingStepTools">
            <button
              type="button"
              className="recordingToolButton"
              onClick={onBack}
            >
              ✎ Edit dialogue
            </button>

            {activeTurn > 0 && (
              <button
                type="button"
                className="recordingToolButton"
                onClick={onPrevious}
              >
                ← Previous take
              </button>
            )}
          </div>

          <div className="recordingReferenceStack">
            <div className="subtitlePanel compactSubtitlePanel">
              <span className="subtitleLabel">
                {
                  t.recording
                    .subtitle
                }
              </span>

              <TimedSubtitle
                line={turn}
                currentTime={
                  videoTime
                }
              />
            </div>

            <div className="traceHeader compactTraceHeader">
              <div>
                <strong>
                  {language === 'ar'
                    ? 'تتبّع الأداء'
                    : 'Performance trace'}
                </strong>

                <span>
                  {language === 'ar'
                    ? 'اتبع التوقيت وقوة الصوت في الموجة الأصلية.'
                    : 'Follow the original timing and vocal energy.'}
                </span>
              </div>

              <span className="traceTime">
                {formatSegmentClock(
                  Math.max(
                    0,
                    videoTime -
                    turn.start
                  )
                )}
                {' / '}
                {formatSegmentClock(
                  turnDuration
                )}
              </span>
            </div>

            <WaveformTrace
              original={
                turnWaveform
              }
              user={
                displayedUserWave
              }
              progress={
                waveformProgress
              }
              playhead={
                segmentProgress
              }
              recording={
                isRecording
              }
            />
          </div>

          <div className="recordingActionArea">
            {segmentState ===
              'preview' && (
                <>
                  <span className="statusPill">
                    {
                      t.recording
                        .original
                    }
                  </span>

                  <h2>
                    {
                      t.recording
                        .listenTitle
                    }
                  </h2>

                  <p>
                    {
                      t.recording
                        .listenText
                    }
                  </p>

                  <button
                    className="secondaryWideButton"
                    onClick={() =>
                      playCurrentSegment()
                    }
                  >
                    ▶︎︎{' '}
                    {
                      t.recording
                        .replayOriginal
                    }
                  </button>

                  <button
                    className="recordButton directRecordButton"
                    onClick={
                      startRealRecording
                    }
                  >
                    <span />

                    {
                      t.recording
                        .startRecording
                    }
                  </button>
                </>
              )}

            {segmentState ===
              'recording' && (
                <>
                  <span className="statusPill liveStatus">
                    ● LIVE
                  </span>

                  <h2>
                    {language ===
                      'ar'
                      ? 'أدِّ الجملة'
                      : 'Perform the line'}
                  </h2>

                  <p>
                    {language ===
                      'ar'
                      ? 'التسجيل بدأ مباشرة. اتبع توقيت المشهد والموجة الأصلية.'
                      : 'Recording started immediately. Follow the scene timing and the original trace.'}
                  </p>

                  <button
                    className="secondaryWideButton"
                    onClick={
                      stopRecording
                    }
                  >
                    ■{' '}
                    {language ===
                      'ar'
                      ? 'إيقاف التسجيل'
                      : 'Stop recording'}
                  </button>
                </>
              )}

            {segmentState ===
              'recorded' && (
                <>
                  <span className="statusPill">
                    {
                      t.recording
                        .yourTake
                    }
                  </span>

                  <h2>
                    {
                      t.recording
                        .listenToTake
                    }
                  </h2>

                  <p>
                    {setup?.mix
                      ?.background_url
                      ? language ===
                        'ar'
                        ? 'استمع إلى تسجيلك مع خلفية المشهد قبل اعتماده.'
                        : 'Preview your take with the scene background before keeping it.'
                      : t.recording
                        .takeText}
                  </p>

                  <button
                    className="secondaryWideButton"
                    onClick={
                      playMyTake
                    }
                  >
                    ▶︎︎{' '}
                    {
                      t.recording
                        .playMyTake
                    }
                  </button>

                  <button
                    className="secondaryWideButton"
                    onClick={
                      retryTake
                    }
                  >
                    ↻{' '}
                    {
                      t.recording
                        .retry
                    }
                  </button>

                  <button
                    className="primaryWideButton"
                    disabled={
                      !currentTake?.url ||
                      advanceBusy
                    }
                    onClick={async () => {
                      if (
                        !currentTake?.url ||
                        advanceBusy
                      ) {
                        return
                      }

                      stopTakePreview()
                      await onNext()
                    }}
                  >
                    {advanceBusy
                      ? language === 'ar'
                        ? 'جارٍ الحفظ...'
                        : 'Saving...'
                      : activeTurn ===
                          turns.length - 1
                        ? t.recording
                          .finish
                        : t.recording
                          .useTake}
                  </button>
                </>
              )}

          </div>

          {(recordingError || advanceError) && (
            <p className="recordingError">
              {recordingError || advanceError}
            </p>
          )}
        </div>
      </div>
    </section>
  )
}

function WaveformTrace({
  original,
  user,
  progress,
  playhead,
  recording,
}) {
  const originalWave =
    resampleWaveform(
      original,
      320
    )

  const userWave =
    resampleWaveform(
      user,
      320
    )

  const visibleCount =
    Math.round(
      Math.min(
        1,
        Math.max(
          0,
          progress
        )
      ) *
      userWave.length
    )

  const playheadPercent =
    Math.min(
      100,
      Math.max(
        0,
        playhead * 100
      )
    )

  return (
    <div className="waveTrace">
      <div className="waveTraceLegend">
        <span className="legendOriginal">
          Original
        </span>

        <span className="legendUser">
          Your voice
        </span>
      </div>

      <div className="waveTraceCanvas">
        <div className="traceGrid">
          <span />
          <span />
          <span />
          <span />
          <span />
        </div>

        <div className="traceCenterLine" />

        <div className="traceBars traceOriginal">
          {originalWave.map(
            (value, index) => (
              <i
                key={`o-${index}`}
                style={{
                  '--level':
                    Math.max(
                      0,
                      Math.min(
                        1,
                        value
                      )
                    ),
                }}
              />
            )
          )}
        </div>

        <div className="traceBars traceUser">
          {userWave.map(
            (value, index) => (
              <i
                key={`u-${index}`}
                className={
                  index <
                    visibleCount
                    ? 'visible'
                    : ''
                }
                style={{
                  '--level':
                    Math.max(
                      0,
                      Math.min(
                        1,
                        value
                      )
                    ),
                }}
              />
            )
          )}
        </div>

        <span
          className={`tracePlayhead ${recording
            ? 'recording'
            : ''
            }`}
          style={{
            left:
              `${playheadPercent}%`,
          }}
        />
      </div>
    </div>
  )
}

function resampleWaveform(
  values,
  targetCount = 320
) {
  if (!values?.length) {
    return Array(
      targetCount
    ).fill(0)
  }

  if (
    values.length ===
    targetCount
  ) {
    return values.map(
      (value) =>
        Math.max(
          0,
          Math.min(
            1,
            Number(value) || 0
          )
        )
    )
  }

  return Array.from(
    {
      length:
        targetCount,
    },
    (_, index) => {
      const start =
        Math.floor(
          (index /
            targetCount) *
          values.length
        )

      const end =
        Math.max(
          start + 1,
          Math.floor(
            ((index + 1) /
              targetCount) *
            values.length
          )
        )

      const chunk =
        values.slice(
          start,
          end
        )

      if (!chunk.length) {
        return 0
      }

      return Math.max(
        0,
        Math.min(
          1,
          Math.max(
            ...chunk.map(
              (value) =>
                Number(value) ||
                0
            )
          )
        )
      )
    }
  )
}

async function extractRealSegmentWaveform(
  mediaUrl,
  startSeconds,
  endSeconds,
  targetCount = 320
) {
  const response =
    await fetch(mediaUrl)

  if (!response.ok) {
    throw new Error(
      'Could not fetch media for waveform.'
    )
  }

  const arrayBuffer =
    await response.arrayBuffer()

  const AudioContext =
    window.AudioContext ||
    window.webkitAudioContext

  const audioContext =
    new AudioContext()

  try {
    const audioBuffer =
      await audioContext
        .decodeAudioData(
          arrayBuffer.slice(0)
        )

    const sampleRate =
      audioBuffer.sampleRate

    const startSample =
      Math.max(
        0,
        Math.floor(
          startSeconds *
          sampleRate
        )
      )

    const endSample =
      Math.min(
        audioBuffer.length,
        Math.ceil(
          endSeconds *
          sampleRate
        )
      )

    const sampleLength =
      Math.max(
        1,
        endSample -
        startSample
      )

    const windowSize =
      Math.max(
        1,
        Math.floor(
          sampleLength /
          targetCount
        )
      )

    const channels =
      Array.from(
        {
          length:
            audioBuffer
              .numberOfChannels,
        },
        (_, channel) =>
          audioBuffer
            .getChannelData(
              channel
            )
      )

    return Array.from(
      {
        length:
          targetCount,
      },
      (_, index) => {
        const from =
          startSample +
          index *
          windowSize

        const to =
          Math.min(
            endSample,
            from +
            windowSize
          )

        if (from >= to) {
          return 0
        }

        let sumSquares = 0
        let peak = 0
        let count = 0

        for (
          let sampleIndex =
            from;
          sampleIndex < to;
          sampleIndex += 1
        ) {
          let mono = 0

          for (
            let channel = 0;
            channel <
            channels.length;
            channel += 1
          ) {
            mono +=
              channels[
              channel
              ][
              sampleIndex
              ] || 0
          }

          mono /=
            Math.max(
              1,
              channels.length
            )

          const abs =
            Math.abs(mono)

          peak = Math.max(
            peak,
            abs
          )

          sumSquares +=
            mono * mono

          count += 1
        }

        const rms =
          Math.sqrt(
            sumSquares /
            Math.max(
              1,
              count
            )
          )

        const combined =
          rms * 0.72 +
          peak * 0.28

        const db =
          combined > 0
            ? 20 *
            Math.log10(
              combined
            )
            : -100

        const noiseFloorDb =
          -60

        const strongDb =
          -9

        if (
          db <=
          noiseFloorDb
        ) {
          return 0
        }

        return Math.pow(
          Math.min(
            1,
            Math.max(
              0,
              (db -
                noiseFloorDb) /
              (strongDb -
                noiseFloorDb)
            )
          ),
          0.82
        )
      }
    )
  } finally {
    audioContext
      .close()
      .catch(() => { })
  }
}

function normalizeWaveform(
  values,
  targetCount = 96
) {
  if (!values?.length) {
    return Array(
      targetCount
    ).fill(0)
  }

  if (
    values.length ===
    targetCount
  ) {
    return values.map(
      (value) =>
        Math.min(
          1,
          Math.max(
            0,
            Number(value) ||
            0
          )
        )
    )
  }

  return Array.from(
    {
      length:
        targetCount,
    },
    (_, index) => {
      const start =
        Math.floor(
          (index /
            targetCount) *
          values.length
        )

      const end =
        Math.max(
          start + 1,
          Math.floor(
            ((index + 1) /
              targetCount) *
            values.length
          )
        )

      const chunk =
        values.slice(
          start,
          end
        )

      return Math.min(
        1,
        Math.max(
          0,
          Math.max(
            ...chunk.map(
              (value) =>
                Number(
                  value
                ) || 0
            )
          )
        )
      )
    }
  )
}

function formatSegmentClock(
  seconds = 0
) {
  const safe =
    Math.max(
      0,
      Number(seconds) ||
      0
    )

  const whole =
    Math.floor(safe)

  const tenths =
    Math.floor(
      (safe - whole) *
      10
    )

  return `${whole}.${tenths}s`
}

function ResultPage({
  t,
  scene,
  setup,
  takes,
  onBack,
  onRetry,
}) {
  return (
    <section className="contentPage resultPage">
      <PageTop
        label={
          t.result.label
        }
        onBack={onBack}
        backLabel={
          t.common.explore
        }
      />

      <div className="resultIntro">
        <span className="eyebrow">
          {
            t.result
              .complete
          }
        </span>

        <h1>
          {t.result.title}
        </h1>

        <p>
          {
            t.result
              .description
          }
        </p>
      </div>

      <ContinuousDubResult
        scene={scene}
        setup={setup}
        takes={takes}
        t={t}
        onRetry={onRetry}
      />
    </section>
  )
}

function ContinuousDubResult({
  scene,
  setup,
  takes,
  t,
  onRetry,
}) {
  const [
    renderStatus,
    setRenderStatus,
  ] = useState(
    'rendering'
  )

  const [
    renderMessage,
    setRenderMessage,
  ] = useState(
    'Building one continuous dub timeline...'
  )

  const [
    finalUrl,
    setFinalUrl,
  ] = useState('')

  const dialogue =
    setup?.dialogue || []

  const recordedEntries =
    dialogue
      .filter(
        (line) =>
          line.role !==
          'original' &&
          takes?.[
            line.id
          ]?.blob
      )
      .map((line) => ({
        line,
        take:
          takes[
          line.id
          ],
      }))

  useEffect(() => {
    let cancelled =
      false

    async function render() {
      if (
        !setup?.mix
          ?.job_id
      ) {
        setRenderStatus(
          'error'
        )

        setRenderMessage(
          'The clean background track is missing. Prepare the scene again.'
        )

        return
      }

      if (
        !recordedEntries
          .length
      ) {
        setRenderStatus(
          'error'
        )

        setRenderMessage(
          'No recorded takes were found.'
        )

        return
      }

      try {
        setRenderStatus(
          'rendering'
        )

        setRenderMessage(
          'Mixing the background, original lines, and your takes into one continuous track...'
        )

        const formData =
          new FormData()

        formData.append(
          'job_id',
          setup.mix.job_id
        )

        const manifest =
          recordedEntries.map(
            (
              { line, take },
              index
            ) => ({
              take_index:
                index,

              line_id:
                line.id,

              start:
                line.start,

              end:
                line.end,

              capture_start:
                take.start ??
                Math.max(
                  0,
                  line.start -
                  0.32
                ),

              capture_end:
                take.end ??
                line.end +
                0.42,

              /*
                Vocal replacement has a smaller
                safety margin than the captured take,
                so we do not erase neighbouring
                dialogue while still avoiding clipped
                syllables at the edges.
              */
              replace_start:
                Math.max(
                  0,
                  line.start -
                  0.10
                ),

              replace_end:
                line.end +
                0.16,

              offset_ms:
                take.offsetMs ||
                0,
            })
          )

        formData.append(
          'manifest',
          JSON.stringify(
            manifest
          )
        )

        recordedEntries.forEach(
          (
            { take },
            index
          ) => {
            formData.append(
              'takes',
              take.blob,
              `take-${index}.webm`
            )
          }
        )

        const response =
          await fetch(
            `${MIX_API}/render-final`,
            {
              method:
                'POST',

              body:
                formData,
            }
          )

        if (!response.ok) {
          const details =
            await response.text()

          throw new Error(
            details ||
            'Final render failed.'
          )
        }

        const data =
          await response.json()

        if (cancelled) {
          return
        }

        setFinalUrl(
          publicBackendUrl(
            data.final_url
          )
        )

        setRenderStatus(
          'ready'
        )

        setRenderMessage(
          'Your continuous dub is ready.'
        )
      } catch (error) {
        console.error(
          'Final render error:',
          error
        )

        if (!cancelled) {
          setRenderStatus(
            'error'
          )

          setRenderMessage(
            'The final dub could not be created.'
          )
        }
      }
    }

    render()

    return () => {
      cancelled = true
    }
  }, [])

  const saveFinalVideo =
    () => {
      if (!finalUrl) {
        return
      }

      const link =
        document.createElement(
          'a'
        )

      link.href =
        finalUrl

      link.download =
        `${scene.title ||
        'vox-scene'
        }-dub.mp4`

      document.body.appendChild(
        link
      )

      link.click()
      link.remove()
    }

  const shareFinalVideo =
    async () => {
      if (!finalUrl) {
        return
      }

      try {
        const response =
          await fetch(
            finalUrl
          )

        const blob =
          await response.blob()

        const file =
          new File(
            [blob],
            `${scene.title ||
            'vox-scene'
            }-dub.mp4`,
            {
              type:
                'video/mp4',
            }
          )

        if (
          navigator.share &&
          navigator.canShare?.({
            files: [file],
          })
        ) {
          await navigator.share({
            files: [file],
            title:
              scene.title ||
              'VOX scene',
          })

          return
        }

        saveFinalVideo()
      } catch {
        saveFinalVideo()
      }
    }

  return (
    <>
      <div className="finalVideoCard professionalFinalCard">
        {finalUrl ? (
          <video
            src={finalUrl}
            controls
            className="mainVideo"
          />
        ) : (
          <div className="finalRenderStage">
            <div className="finalRenderPulse" />

            <span className="eyebrow">
              FINAL DUB
            </span>

            <h3>
              {renderStatus ===
                'error'
                ? 'Could not finish the dub.'
                : 'Building your final scene'}
            </h3>

            <p>
              {
                renderMessage
              }
            </p>

            {renderStatus ===
              'rendering' && (
                <div className="finalRenderTrack">
                  <span />
                </div>
              )}
          </div>
        )}

        {finalUrl && (
          <div className="finalMixBadge">
            FINAL DUB
          </div>
        )}
      </div>

      <div className="resultActions">
        <button
          className="secondaryWideButton"
          onClick={
            onRetry
          }
        >
          ↻{' '}
          {t.result.retry}
        </button>

        <button
          className="secondaryWideButton"
          disabled={
            !finalUrl
          }
          onClick={
            saveFinalVideo
          }
        >
          ↓ {t.result.save}
        </button>

        <button
          className="primaryWideButton"
          disabled={
            !finalUrl
          }
          onClick={
            shareFinalVideo
          }
        >
          ↗ {t.result.share}
        </button>
      </div>
    </>
  )
}

function AuthPage({
  language,
  busy,
  error,
  onBack,
  onSubmit,
  onTerms,
  onPrivacy,
}) {
  const [mode, setMode] =
    useState('signup')

  const [name, setName] =
    useState('')

  const [email, setEmail] =
    useState('')

  const [password, setPassword] =
    useState('')

  const [accepted, setAccepted] =
    useState(false)

  const isSignup =
    mode === 'signup'

  return (
    <section className="contentPage authPage">
      <PageTop
        label="VOX ACCOUNT"
        onBack={onBack}
        backLabel={
          language === 'ar'
            ? 'رجوع'
            : 'Back'
        }
      />

      <div className="authLayout">
        <aside className="authPitch">
          <span className="eyebrow">
            {isSignup
              ? language === 'ar'
                ? 'أول فيديو مجانًا'
                : 'FIRST CREATION FREE'
              : language === 'ar'
                ? 'مرحبًا بعودتك'
                : 'WELCOME BACK'}
          </span>

          <h1>
            {isSignup
              ? language === 'ar'
                ? 'ابدأ مع VOX.'
                : 'Start with VOX.'
              : language === 'ar'
                ? 'كمّل من حسابك.'
                : 'Pick up where you left off.'}
          </h1>

          <p>
            {language === 'ar'
              ? 'حسابك يحفظ رصيدك وعمليات الدفع فقط. أول تجربة لك مجانية.'
              : 'Your account keeps your credits and purchase history. Your first creation is free.'}
          </p>

          <div className="authBenefits">
            <span>
              {language === 'ar'
                ? '✓ أول فيديو مجاني'
                : '✓ First creation free'}
            </span>
            <span>
              {language === 'ar'
                ? '✓ الرصيد يتراكم'
                : '✓ Credits stack'}
            </span>
            <span>
              {language === 'ar'
                ? '✓ الضيف لا يستهلك رصيد'
                : '✓ Guests use no credits'}
            </span>
          </div>
        </aside>

        <div className="authCard">
          <div className="authTabs">
            <button
              type="button"
              className={
                isSignup
                  ? 'active'
                  : ''
              }
              onClick={() =>
                setMode('signup')
              }
            >
              {language === 'ar'
                ? 'إنشاء حساب'
                : 'Sign up'}
            </button>

            <button
              type="button"
              className={
                !isSignup
                  ? 'active'
                  : ''
              }
              onClick={() =>
                setMode('login')
              }
            >
              {language === 'ar'
                ? 'تسجيل الدخول'
                : 'Log in'}
            </button>
          </div>

          <div className="authFormIntro">
            <h2>
              {isSignup
                ? language === 'ar'
                  ? 'إنشاء حساب جديد'
                  : 'Create your account'
                : language === 'ar'
                  ? 'تسجيل الدخول'
                  : 'Welcome back'}
            </h2>

            <p>
              {isSignup
                ? language === 'ar'
                  ? 'أدخل بياناتك وابدأ أول تجربة مجانًا.'
                  : 'Enter your details and start your first creation free.'
                : language === 'ar'
                  ? 'أدخل بيانات حسابك للمتابعة.'
                  : 'Enter your account details to continue.'}
            </p>
          </div>

          {isSignup && (
            <label className="accountField">
              <span>
                {language === 'ar'
                  ? 'الاسم'
                  : 'Name'}
              </span>
              <input
                value={name}
                onChange={(event) =>
                  setName(event.target.value)
                }
              />
            </label>
          )}

          <label className="accountField">
            <span>
              {language === 'ar'
                ? 'البريد الإلكتروني'
                : 'Email'}
            </span>
            <input
              type="email"
              value={email}
              onChange={(event) =>
                setEmail(event.target.value)
              }
            />
          </label>

          <label className="accountField">
            <span>
              {language === 'ar'
                ? 'كلمة المرور'
                : 'Password'}
            </span>
            <input
              type="password"
              value={password}
              onChange={(event) =>
                setPassword(event.target.value)
              }
            />
          </label>

          {isSignup && (
            <label className="termsCheck">
              <input
                type="checkbox"
                checked={accepted}
                onChange={(event) =>
                  setAccepted(
                    event.target.checked
                  )
                }
              />

              <span>
                {language === 'ar' ? (
                  <>
                    أوافق على{' '}
                    <button
                      type="button"
                      className="inlinePolicyLink"
                      onClick={(event) => {
                        event.preventDefault()
                        onTerms?.()
                      }}
                    >
                      الشروط والأحكام
                    </button>
                    {' '}و{' '}
                    <button
                      type="button"
                      className="inlinePolicyLink"
                      onClick={(event) => {
                        event.preventDefault()
                        onPrivacy?.()
                      }}
                    >
                      سياسة الخصوصية
                    </button>
                    .
                  </>
                ) : (
                  <>
                    I agree to the{' '}
                    <button
                      type="button"
                      className="inlinePolicyLink"
                      onClick={(event) => {
                        event.preventDefault()
                        onTerms?.()
                      }}
                    >
                      Terms & Conditions
                    </button>
                    {' '}and{' '}
                    <button
                      type="button"
                      className="inlinePolicyLink"
                      onClick={(event) => {
                        event.preventDefault()
                        onPrivacy?.()
                      }}
                    >
                      Privacy Policy
                    </button>
                    .
                  </>
                )}
              </span>
            </label>
          )}

          {error && (
            <p className="accountError">
              {error}
            </p>
          )}

          <button
            type="button"
            className="primaryWideButton authSubmitButton"
            disabled={
              busy ||
              !email ||
              !password ||
              (
                isSignup &&
                (!name || !accepted)
              )
            }
            onClick={() =>
              onSubmit({
                mode,
                name,
                email,
                password,
                acceptedTerms:
                  accepted,
              })
            }
          >
            {busy
              ? language === 'ar'
                ? 'جارٍ المتابعة...'
                : 'Please wait...'
              : isSignup
                ? language === 'ar'
                  ? 'إنشاء الحساب'
                  : 'Create account'
                : language === 'ar'
                  ? 'دخول'
                  : 'Log in'}
          </button>
        </div>
      </div>
    </section>
  )
}



function PolicyPage({
  language,
  type,
  onBack,
}) {
  const isTerms =
    type === 'terms'

  const title =
    language === 'ar'
      ? isTerms
        ? 'الشروط والأحكام'
        : 'سياسة الخصوصية'
      : isTerms
        ? 'Terms & Conditions'
        : 'Privacy Policy'

  return (
    <section className="contentPage policyPage">
      <PageTop
        label="VOX"
        onBack={onBack}
        backLabel={
          language === 'ar'
            ? 'العودة للتسجيل'
            : 'Back to sign up'
        }
      />

      <article className="policyCard">
        <span className="eyebrow">
          VOX · {isTerms ? 'TERMS' : 'PRIVACY'}
        </span>

        <h1>{title}</h1>

        {isTerms ? (
          <>
            <p>
              {language === 'ar'
                ? 'باستخدام VOX أنت تؤكد أن لديك الحق أو الإذن اللازم لرفع ومعالجة المحتوى الذي تختاره، وأنك مسؤول عن كيفية استخدام أو نشر النسخة الناتجة.'
                : 'By using VOX, you confirm that you have the rights or permission needed to upload and process the content you choose, and you are responsible for how you use or publish the resulting file.'}
            </p>

            <h2>
              {language === 'ar'
                ? 'الاستخدام والرصيد'
                : 'Usage & credits'}
            </h2>

            <p>
              {language === 'ar'
                ? 'الرفع والتحليل والتعديل لا يستهلك رصيدًا. تُحسب محاولة واحدة عند بدء أول تسجيل فعلي للمشهد. إعادة تسجيل نفس المشهد في الجلسة نفسها لا تخصم محاولة جديدة. في وضع Invite يخصم الرصيد من المضيف فقط.'
                : 'Uploading, analysis, and editing do not consume a credit. One creation is counted when the first actual recording begins. Re-recording the same scene in the same creation does not use another credit. In Invite mode, only the host is charged.'}
            </p>

            <h2>
              {language === 'ar'
                ? 'حد الفيديو'
                : 'Video limit'}
            </h2>

            <p>
              {language === 'ar'
                ? 'تدعم النسخة الحالية مشاهد تصل مدتها إلى خمس دقائق.'
                : 'The current version supports scenes up to five minutes long.'}
            </p>
          </>
        ) : (
          <>
            <p>
              {language === 'ar'
                ? 'يستخدم VOX بيانات الحساب لتسجيل الدخول، إدارة الرصيد وسجل عمليات الشراء. ملفات الفيديو والصوت تُستخدم لمعالجة الجلسة ولا تُعرض كمكتبة عامة.'
                : 'VOX uses account information for sign-in, credit management, and purchase history. Video and audio files are used to process the session and are not published as a public library.'}
            </p>

            <h2>
              {language === 'ar'
                ? 'بيانات الحساب'
                : 'Account data'}
            </h2>

            <p>
              {language === 'ar'
                ? 'نحتفظ بالاسم والبريد وبيانات الرصيد وسجل المشتريات اللازمة لتشغيل الحساب. كلمة المرور لا تُخزن كنص واضح.'
                : 'We keep the name, email, credit balance, and purchase history needed to operate the account. Passwords are not stored as plain text.'}
            </p>

            <h2>
              {language === 'ar'
                ? 'ملفات الوسائط'
                : 'Media files'}
            </h2>

            <p>
              {language === 'ar'
                ? 'الهدف في النسخة النهائية هو التعامل مع ملفات الوسائط بشكل مؤقت لأغراض المعالجة والتصدير، وليس إنشاء مكتبة عامة أو الاحتفاظ بالنسخ النهائية كمنشورات داخل VOX.'
                : 'The intended production behavior is to handle media files temporarily for processing and export, not to build a public library or keep final edited copies as VOX posts.'}
            </p>
          </>
        )}

        <p className="policyDraftNote">
          {language === 'ar'
            ? 'هذه صياغة أولية للاختبار ويجب مراجعتها قانونيًا قبل الإطلاق التجاري.'
            : 'This is a product-testing draft and should be legally reviewed before commercial launch.'}
        </p>
      </article>
    </section>
  )
}



function PackageCards({
  language,
  busy,
  onBuy,
}) {
  const packages = [
    {
      id: 'mini',
      name: 'Mini',
      price: 19,
      credits: 3,
      featured: false,
    },
    {
      id: 'creator',
      name: 'Creator',
      price: 39,
      credits: 10,
      featured: true,
    },
  ]

  return (
    <div className="packageGrid">
      {packages.map((pack) => (
        <article
          key={pack.id}
          className={`packageCard ${
            pack.featured
              ? 'featured'
              : ''
          }`}
        >
          <div className="packageTop">
            <div>
              <h3>{pack.name}</h3>

              <strong className="packagePrice">
                {pack.price}
                <small>
                  {language === 'ar'
                    ? ' ر.س'
                    : ' SAR'}
                </small>
              </strong>
            </div>

            {pack.featured && (
              <span className="packageBadge">
                {language === 'ar'
                  ? 'الأفضل قيمة'
                  : 'BEST VALUE'}
              </span>
            )}
          </div>

          <p>
            {pack.credits}{' '}
            {language === 'ar'
              ? 'فيديوهات'
              : 'creations'}
          </p>

          <button
            type="button"
            className={
              pack.featured
                ? 'primaryWideButton'
                : 'secondaryWideButton'
            }
            disabled={busy}
            onClick={() =>
              onBuy(pack.id)
            }
          >
            {language === 'ar'
              ? 'شراء الرصيد'
              : 'Get credits'}
          </button>
        </article>
      ))}
    </div>
  )
}



function ProfilePage({
  language,
  user,
  busy,
  error,
  onBack,
  onBuy,
  onLogout,
  onTerms,
  onPrivacy,
}) {
  if (!user) {
    return null
  }

  return (
    <section className="contentPage profilePage">
      <PageTop
        label={
          language === 'ar'
            ? 'حسابي'
            : 'MY PROFILE'
        }
        onBack={onBack}
        backLabel={
          language === 'ar'
            ? 'رجوع'
            : 'Back'
        }
      />

      <div className="profileHero">
        <div>
          <span className="eyebrow">
            {user.email}
          </span>
          <h1>{user.name}</h1>
        </div>

        <button
          className="textButton"
          onClick={onLogout}
        >
          {language === 'ar'
            ? 'تسجيل الخروج'
            : 'Log out'}
        </button>
      </div>

      <div className="creditSummaryCard">
        <span>
          {language === 'ar'
            ? 'الرصيد الحالي'
            : 'CURRENT BALANCE'}
        </span>

        <strong>
          {user.remaining_creations}
        </strong>

        <h2>
          {language === 'ar'
            ? 'فيديو متبقي'
            : 'creations remaining'}
        </h2>

        <div className="creditStats">
          <div>
            <b>
              {user.total_purchased}
            </b>
            <span>
              {language === 'ar'
                ? 'إجمالي المشتريات'
                : 'Purchased'}
            </span>
          </div>

          <div>
            <b>
              {user.total_used}
            </b>
            <span>
              {language === 'ar'
                ? 'المستخدم'
                : 'Used'}
            </span>
          </div>

          <div>
            <b>
              {user.free_trial_used
                ? 'Used'
                : '1'}
            </b>
            <span>
              {language === 'ar'
                ? 'التجربة المجانية'
                : 'Free trial'}
            </span>
          </div>
        </div>
      </div>

      <div className="profileSectionHead">
        <div>
          <span className="eyebrow">
            {language === 'ar'
              ? 'إضافة رصيد'
              : 'BUY MORE'}
          </span>
          <h2>
            {language === 'ar'
              ? 'خطط VOX'
              : 'VOX Credits'}
          </h2>
        </div>
      </div>

      <PackageCards
        language={language}
        busy={busy}
        onBuy={onBuy}
      />

      <div className="profileSectionHead">
        <div>
          <span className="eyebrow">
            {language === 'ar'
              ? 'السجل'
              : 'HISTORY'}
          </span>
          <h2>
            {language === 'ar'
              ? 'عمليات الدفع'
              : 'Purchase history'}
          </h2>
        </div>
      </div>

      <div className="purchaseList">
        {user.purchases?.length ? (
          user.purchases.map(
            (purchase) => (
              <article
                className="purchaseCard"
                key={purchase.id}
              >
                <div>
                  <span className="eyebrow">
                    {purchase.package_name}
                  </span>
                  <h3>
                    +{purchase.credits_added}{' '}
                    {language === 'ar'
                      ? 'فيديو'
                      : 'creations'}
                  </h3>
                </div>

                <div className="purchaseMeta">
                  <strong>
                    {purchase.price_sar}{' '}
                    SAR
                  </strong>
                  <span>
                    {new Date(
                      purchase.created_at
                    ).toLocaleDateString()}
                  </span>
                </div>
              </article>
            )
          )
        ) : (
          <div className="libraryEmpty">
            <strong>
              {language === 'ar'
                ? 'لا توجد مشتريات بعد'
                : 'No purchases yet'}
            </strong>
            <span>
              {language === 'ar'
                ? 'التجربة المجانية موجودة تلقائيًا في حسابك.'
                : 'Your free creation is already included with your account.'}
            </span>
          </div>
        )}
      </div>

      <div className="profileAccountActions">
        <button
          type="button"
          className="profileTextAction"
          onClick={onPrivacy}
        >
          {language === 'ar'
            ? 'سياسة الخصوصية'
            : 'Privacy Policy'}
        </button>

        <button
          type="button"
          className="profileTextAction"
          onClick={onTerms}
        >
          {language === 'ar'
            ? 'الشروط والأحكام'
            : 'Terms & Conditions'}
        </button>

        <button
          type="button"
          className="profileLogoutButton"
          onClick={onLogout}
        >
          {language === 'ar'
            ? 'تسجيل الخروج'
            : 'Log out'}
        </button>
      </div>

      {error && (
        <p className="accountError">
          {error}
        </p>
      )}
    </section>
  )
}


function JoinRoomModal({
  language,
  value,
  onChange,
  onClose,
  onJoin,
}) {
  return (
    <div
      className="creditsModalBackdrop"
      onMouseDown={onClose}
    >
      <div
        className="joinRoomModal"
        onMouseDown={(event) =>
          event.stopPropagation()
        }
      >
        <button
          className="creditsModalClose"
          onClick={onClose}
          aria-label="Close"
        >
          ×
        </button>

        <span className="eyebrow">
          INVITE
        </span>

        <h2>
          {language === 'ar'
            ? 'انضم إلى غرفة'
            : 'Join a room'}
        </h2>

        <p>
          {language === 'ar'
            ? 'أدخل كود الغرفة الذي أرسله لك الهوست.'
            : 'Enter the room code your host shared with you.'}
        </p>

        <input
          className="joinRoomModalInput"
          value={value}
          maxLength={12}
          autoFocus
          onChange={(event) =>
            onChange(
              event.target.value.toUpperCase()
            )
          }
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              onJoin()
            }
          }}
          placeholder={
            language === 'ar'
              ? 'كود الغرفة'
              : 'ROOM CODE'
          }
        />

        <button
          className="primaryWideButton"
          disabled={!value.trim()}
          onClick={onJoin}
        >
          {language === 'ar'
            ? 'دخول الغرفة'
            : 'Join room'}
        </button>
      </div>
    </div>
  )
}



function CreditsModal({
  language,
  busy,
  onClose,
  onBuy,
}) {
  return (
    <div
      className="creditsModalBackdrop"
      onMouseDown={onClose}
    >
      <div
        className="creditsModal"
        onMouseDown={(event) =>
          event.stopPropagation()
        }
      >
        <button
          className="creditsModalClose"
          onClick={onClose}
        >
          ×
        </button>

        <span className="eyebrow">
          {language === 'ar'
            ? 'جاهز للتسجيل؟'
            : 'READY TO PERFORM?'}
        </span>

        <h2>
          {language === 'ar'
            ? 'انتهت تجربتك المجانية'
            : 'Your free creation is used'}
        </h2>

        <p>
          {language === 'ar'
            ? 'اختر رصيد VOX للمتابعة. شراء الباقات هنا تجريبي في Phase 1 ولا يتم خصم أي مبلغ حقيقي.'
            : 'Choose a VOX credit pack to continue. Purchases are simulated in Phase 1; no real payment is charged.'}
        </p>

        <PackageCards
          language={language}
          busy={busy}
          onBuy={onBuy}
        />
      </div>
    </div>
  )
}



function CreatePage({
  t,
  language,
  onBack,
  onUpload,
  isAnalyzing,
  analysisError,
  analysisProgress,
  analysisStage,
}) {
  const [file, setFile] = useState(null)
  const [speechLanguage, setSpeechLanguage] = useState('auto')
  const [durationError, setDurationError] = useState('')

  return (
    <section className="contentPage">
      <PageTop
        label={t.create.label}
        onBack={onBack}
        backLabel={t.common.back}
      />

      <div className="createIntro">
        <span className="eyebrow">
          {t.create.eyebrow}
        </span>

        <h1>
          {t.create.title}
        </h1>

        <p>
          {t.create.description}
        </p>
      </div>

      <div className="speechLanguageSection">
        <div>
          <span className="eyebrow">
            {t.create.speechLanguageLabel}
          </span>

          <p>
            {t.create.speechLanguageText}
          </p>
        </div>

        <div className="speechLanguageControl">
          {[
            ['auto', t.create.languageAuto],
            ['ar', t.create.languageArabic],
            ['en', t.create.languageEnglish],
          ].map(([value, label]) => (
            <button
              type="button"
              key={value}
              className={
                speechLanguage === value
                  ? 'active'
                  : ''
              }
              onClick={() =>
                setSpeechLanguage(value)
              }
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="uploadBox">
        <span className="uploadIcon">
          ↑
        </span>

        <h3>
          {file
            ? file.name
            : t.create.uploadTitle}
        </h3>

        <p>
          {file
            ? t.create.fileReady
            : t.create.uploadText}
        </p>

        <label className="uploadButton">
          {file
            ? t.create.changeVideo
            : t.create.chooseVideo}

          <input
            type="file"
            accept="video/*"
            onChange={(event) => {
              const nextFile =
                event.target.files?.[0] ||
                null

              setDurationError('')

              if (!nextFile) {
                setFile(null)
                return
              }

              const previewUrl =
                URL.createObjectURL(
                  nextFile
                )

              const probe =
                document.createElement(
                  'video'
                )

              probe.preload =
                'metadata'

              probe.onloadedmetadata =
                () => {
                  const seconds =
                    Number(
                      probe.duration || 0
                    )

                  URL.revokeObjectURL(
                    previewUrl
                  )

                  if (
                    seconds >
                    300
                  ) {
                    setFile(null)
                    setDurationError(
                      language === 'ar'
                        ? `مدة الفيديو ${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}. الحد الحالي 5 دقائق. قص المشهد ثم حاول مرة أخرى.`
                        : `This video is ${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}. VOX currently supports scenes up to 5 minutes. Trim it and try again.`
                    )
                    return
                  }

                  setFile(
                    nextFile
                  )
                }

              probe.onerror =
                () => {
                  URL.revokeObjectURL(
                    previewUrl
                  )
                  setFile(nextFile)
                }

              probe.src =
                previewUrl
            }}
          />
        </label>

        {file && (
          <button
            className="primaryWideButton uploadPrepareButton"
            disabled={isAnalyzing}
            onClick={() =>
              onUpload(
                file,
                speechLanguage
              )
            }
          >
            {isAnalyzing
              ? t.create.preparing
              : t.create.prepare}
          </button>
        )}

        <p className="uploadLimitHint">
          {language === 'ar'
            ? 'الفيديوهات حتى 5 دقائق'
            : 'Videos up to 5 minutes'}
        </p>

        {(durationError || analysisError) && (
          <p className="uploadError">
            {durationError || analysisError}
          </p>
        )}
      </div>

      {isAnalyzing && (
        <AnalysisProgress
          t={t}
          progress={analysisProgress}
          stage={analysisStage}
        />
      )}

      <div className="aiPreparation">
        <span className="eyebrow">
          {t.create.aiLabel}
        </span>

        <div className="aiSteps">
          <span>
            01 · {t.create.step1}
          </span>

          <span>
            02 · {t.create.step2}
          </span>

          <span>
            03 · {t.create.step3}
          </span>

          <span>
            04 · {t.create.step4}
          </span>
        </div>
      </div>
    </section>
  )
}

function AnalysisProgress({
  t,
  progress,
  stage,
}) {
  return (
    <div className="analysisProgressCard">
      <div className="analysisProgressTop">
        <div>
          <strong>
            {t.analysis.title}
          </strong>

          <span>
            {stage}
          </span>
        </div>

        <strong className="analysisPercent">
          {Math.round(progress)}%
        </strong>
      </div>

      <div className="analysisProgressTrack">
        <span
          style={{
            width: `${progress}%`,
          }}
        />
      </div>

      <p>
        {t.analysis.note}
      </p>
    </div>
  )
}

function EditableSceneTitle({
  title,
  t,
  onSave,
}) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(title)

  const save = () => {
    const clean = value.trim()

    if (!clean) {
      setValue(title)
      setEditing(false)
      return
    }

    onSave?.(clean)
    setEditing(false)
  }

  if (editing) {
    return (
      <div className="editableSceneTitle editing">
        <input
          value={value}
          autoFocus
          maxLength={80}
          onChange={(event) =>
            setValue(event.target.value)
          }
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              save()
            }

            if (event.key === 'Escape') {
              setValue(title)
              setEditing(false)
            }
          }}
        />

        <button
          type="button"
          className="sceneTitleSave"
          onClick={save}
        >
          ✓
        </button>
      </div>
    )
  }

  return (
    <div className="editableSceneTitle">
      <h1>{title}</h1>

      <button
        type="button"
        className="sceneTitleEdit"
        aria-label={t.create.renameScene}
        title={t.create.renameScene}
        onClick={() => {
          setValue(title)
          setEditing(true)
        }}
      >
        ✎
      </button>
    </div>
  )
}

function PageTop({
  label,
  onBack,
  backLabel,
}) {
  return (
    <div className="pageTop">
      <button
        className="backButton"
        onClick={onBack}
      >
        ← {backLabel}
      </button>

      <span>{label}</span>
    </div>
  )
}

function Waveform({
  values,
  animate = true,
}) {
  const data =
    values?.length
      ? values
      : Array.from(
        { length: 52 },
        (_, index) =>
          0.2 +
          ((index * 17) % 47) / 60
      )

  return (
    <div
      className={`waveform ${animate
        ? 'waveformAnimated'
        : ''
        }`}
    >
      {data.map((value, index) => (
        <span
          key={index}
          style={{
            height: `${Math.max(
              6,
              value * 62
            )}px`,
          }}
        />
      ))}
    </div>
  )
}

function TimedSubtitle({
  line,
  currentTime,
}) {
  if (!line?.words?.length) {
    return (
      <p className="timedSubtitle">
        {line.text}
      </p>
    )
  }

  return (
    <p className="timedSubtitle">
      {line.words.map(
        (word, index) => {
          const active =
            currentTime >= word.start &&
            currentTime <= word.end

          const passed =
            currentTime > word.end

          return (
            <span
              key={`${word.word}-${index}`}
              className={
                active
                  ? 'wordActive'
                  : passed
                    ? 'wordPassed'
                    : ''
              }
            >
              {word.word}{' '}
            </span>
          )
        }
      )}
    </p>
  )
}

function sliceWaveform(
  waveform,
  start,
  end,
  duration
) {
  if (
    !waveform?.length ||
    !duration ||
    duration <= 0
  ) {
    return []
  }

  const startIndex = Math.floor(
    (start / duration) *
    waveform.length
  )

  const endIndex = Math.ceil(
    (end / duration) *
    waveform.length
  )

  return waveform.slice(
    Math.max(0, startIndex),
    Math.min(
      waveform.length,
      endIndex + 1
    )
  )
}

function HowItem({
  number,
  title,
  text,
}) {
  return (
    <article className="howItem">
      <span>{number}</span>

      <h3>{title}</h3>

      <p>{text}</p>
    </article>
  )
}

function Stat({
  label,
  value,
}) {
  return (
    <div className="stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

export default App
