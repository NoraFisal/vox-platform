import {
  useMemo,
  useRef,
  useState,
} from 'react'

import {
  Check,
  Clock3,
  GitMerge,
  Pencil,
  Plus,
  Scissors,
  Trash2,
  Volume2,
  X,
} from 'lucide-react'

import './DialogueSetup.css'

const copy = {
  en: {
    eyebrow: 'DIALOGUE SETUP',
    title: 'Review the dialogue',
    description:
      'Review the detected parts, adjust their timing, add any missing performance moments, then choose who performs each part.',

    timelineTitle: 'Scene timeline',
    timelineHelp:
      'Play the video, adjust any detected part, or add a new part even when there is no dialogue.',
    addSegment: 'Add segment here',
    timing: 'Adjust timing',
    timingTitle: 'Segment timing',
    start: 'Start',
    end: 'End',
    setStartHere: 'Use current time as start',
    setEndHere: 'Use current time as end',
    previewSegment: 'Preview segment',
    manualSegment: 'Performance segment',
    noDialogueHint:
      'No dialogue was detected. You can still add any part of the video you want to perform.',

    lines: 'dialogue lines',
    assigned: 'assigned',

    me: 'Me',
    person1: 'Person 1',
    person2: 'Person 2',
    original: 'Original',

    originalHint:
      'Keep the original voice for this line',

    edit: 'Edit text',
    split: 'Split line',
    merge: 'Merge with next line',

    splitTitle: 'Choose where to split',
    splitHelp:
      'Click between two words. The second part will appear as a new block underneath.',

    cancel: 'Cancel',
    save: 'Save',

    ready: 'Dialogue setup is ready.',
    remaining:
      'Assign every line before continuing.',

    continue: 'Continue',

    publish: 'Publish to library',
    publishText:
      'Make this prepared scene available in the community library.',

    noDialogue:
      'No dialogue was detected in this scene.',
  },

  ar: {
    eyebrow: 'إعداد الحوار',
    title: 'راجع الحوار',
    description:
      'راجع الأجزاء المكتشفة، وعدّل توقيتها أو أضف أي مقطع ناقص، ثم حدّد من سيؤدي كل جزء.',

    timelineTitle: 'مخطط المشهد',
    timelineHelp:
      'شغّل الفيديو، وعدّل حدود أي جزء أو أضف جزءًا جديدًا حتى لو لم يكن فيه حوار.',
    addSegment: 'إضافة مقطع هنا',
    timing: 'تعديل التوقيت',
    timingTitle: 'توقيت المقطع',
    start: 'البداية',
    end: 'النهاية',
    setStartHere: 'اجعل الوقت الحالي بداية',
    setEndHere: 'اجعل الوقت الحالي نهاية',
    previewSegment: 'معاينة المقطع',
    manualSegment: 'مقطع أداء',
    noDialogueHint:
      'لم يتم اكتشاف حوار، لكن يمكنك إضافة أي جزء من الفيديو تريد تقليده.',

    lines: 'سطر حوار',
    assigned: 'تم إسنادها',

    me: 'أنا',
    person1: 'الشخص الأول',
    person2: 'الشخص الثاني',
    original: 'الصوت الأصلي',

    originalHint:
      'الاحتفاظ بالصوت الأصلي لهذا السطر',

    edit: 'تعديل النص',
    split: 'تقسيم السطر',
    merge: 'دمج مع السطر التالي',

    splitTitle: 'اختر موضع التقسيم',
    splitHelp:
      'اضغط بين كلمتين، وسيظهر الجزء الثاني كبلوك مستقل أسفل السطر مباشرة.',

    cancel: 'إلغاء',
    save: 'حفظ',

    ready: 'اكتمل إعداد الحوار.',
    remaining:
      'حدّد دور كل سطر قبل المتابعة.',

    continue: 'متابعة',

    publish: 'نشر في المكتبة',
    publishText:
      'إتاحة هذا المشهد بعد إعداده ضمن مكتبة المجتمع.',

    noDialogue:
      'لم يتم العثور على حوار في هذا المشهد.',
  },
}

function containsArabic(text = '') {
  return /[\u0600-\u06FF]/.test(text)
}

function flattenWords(analysis) {
  return (
    analysis?.transcription?.segments
      ?.flatMap(
        (segment) =>
          segment.words || []
      ) || []
  )
}

function wordsForLine(
  allWords,
  line
) {
  return allWords.filter(
    (word) => {
      const middle =
        (word.start + word.end) / 2

      return (
        middle >=
          line.start - 0.05 &&
        middle <=
          line.end + 0.05
      )
    }
  )
}

function buildDialogue(
  analysis,
  savedSetup
) {
  if (
    savedSetup?.dialogue?.length
  ) {
    return savedSetup.dialogue
  }

  const subtitleLines =
    analysis?.subtitle_lines || []

  const allWords =
    flattenWords(analysis)

  return subtitleLines.map(
    (line, index) => ({
      id: `line-${index + 1}`,

      text: line.text,

      start: line.start,
      end: line.end,

      words: wordsForLine(
        allWords,
        line
      ),

      role: null,
    })
  )
}

function formatTime(
  seconds = 0
) {
  const minutes =
    Math.floor(seconds / 60)

  const secs =
    seconds % 60

  return `${String(
    minutes
  ).padStart(
    2,
    '0'
  )}:${secs
    .toFixed(1)
    .padStart(4, '0')}`
}

function approximateWords(
  text,
  start,
  end
) {
  const tokens =
    text
      .trim()
      .split(/\s+/)
      .filter(Boolean)

  if (!tokens.length) {
    return []
  }

  const duration =
    Math.max(
      0.01,
      end - start
    )

  return tokens.map(
    (word, index) => ({
      word,

      start: Number(
        (
          start +
          duration *
            (index /
              tokens.length)
        ).toFixed(2)
      ),

      end: Number(
        (
          start +
          duration *
            ((index + 1) /
              tokens.length)
        ).toFixed(2)
      ),
    })
  )
}

function IconButton({
  label,
  active,
  onClick,
  children,
}) {
  return (
    <button
      type="button"
      className={`dsIconButton ${
        active ? 'active' : ''
      }`}
      aria-label={label}
      onClick={onClick}
    >
      {children}

      <span className="dsTooltip">
        {label}
      </span>
    </button>
  )
}

export default function DialogueSetup({
  language = 'en',
  scene,
  mode = 'solo',
  analysis,
  savedSetup,
  roleNames = null,
  readOnly = false,
  onBack,
  onContinue,
}) {
  const l =
    copy[language] || copy.en

  const isDuo =
    mode === 'together' ||
    mode === 'invite'

  const person1Label =
    roleNames?.person1 ||
    l.person1

  const person2Label =
    roleNames?.person2 ||
    l.person2


  const videoRef =
    useRef(null)

  const [videoTime, setVideoTime] =
    useState(0)

  const [
    timingId,
    setTimingId,
  ] = useState(null)

  const [
    draggingHandle,
    setDraggingHandle,
  ] = useState(null)

  const duration =
    analysis?.duration_seconds ||
    savedSetup?.duration ||
    0

  const [lines, setLines] =
    useState(() =>
      buildDialogue(
        analysis,
        savedSetup
      )
    )

  const [
    editingId,
    setEditingId,
  ] = useState(null)

  const [
    splittingId,
    setSplittingId,
  ] = useState(null)

  const [
    publish,
    setPublish,
  ] = useState(
    savedSetup?.publish ||
      false
  )

  const assignedCount =
    useMemo(
      () =>
        lines.filter(
          (line) =>
            line.role
        ).length,
      [lines]
    )

  const allAssigned =
    lines.length > 0 &&
    assignedCount ===
      lines.length

  function clampTime(
    value,
    fallback = 0
  ) {
    const parsed =
      Number(value)

    if (!Number.isFinite(parsed)) {
      return fallback
    }

    return Math.max(
      0,
      duration
        ? Math.min(
            duration,
            parsed
          )
        : parsed
    )
  }

  function seekVideo(time) {
    const video =
      videoRef.current

    if (!video) return

    const next =
      clampTime(time)

    video.currentTime =
      next

    setVideoTime(next)
  }

  function previewLine(line) {
    const video =
      videoRef.current

    if (!video) return

    video.pause()
    video.currentTime =
      line.start

    const stopAt =
      line.end

    const onTimeUpdate =
      () => {
        setVideoTime(
          video.currentTime
        )

        if (
          video.currentTime >=
          stopAt
        ) {
          video.pause()

          video.removeEventListener(
            'timeupdate',
            onTimeUpdate
          )
        }
      }

    video.addEventListener(
      'timeupdate',
      onTimeUpdate
    )

    video.play().catch(() => {
      video.removeEventListener(
        'timeupdate',
        onTimeUpdate
      )
    })
  }

  function addSegment(
    requestedStart = videoTime
  ) {
    const start =
      clampTime(
        requestedStart,
        0
      )

    const defaultLength =
      1.5

    const end =
      duration
        ? Math.min(
            duration,
            start +
              defaultLength
          )
        : start +
          defaultLength

    const line = {
      id:
        `manual-${Date.now()}`,

      text:
        l.manualSegment,

      start,
      end:
        Math.max(
          start + 0.1,
          end
        ),

      words: [],
      role: null,
      manual: true,
    }

    setLines(
      (current) =>
        [...current, line]
          .sort(
            (a, b) =>
              a.start -
              b.start
          )
    )

    setTimingId(
      line.id
    )
  }

  function getSelectedLine() {
    return (
      lines.find(
        (line) =>
          line.id === timingId
      ) || null
    )
  }

  function splitSelectedAtPlayhead() {
    const line =
      getSelectedLine()

    if (!line) return

    const splitTime =
      Math.max(
        line.start + 0.12,
        Math.min(
          line.end - 0.12,
          videoTime
        )
      )

    if (
      splitTime <= line.start ||
      splitTime >= line.end
    ) {
      return
    }

    let leftText =
      line.text

    let rightText =
      line.text

    if (line.words?.length) {
      const leftWords =
        line.words.filter(
          (word) =>
            (word.end ??
              word.start ??
              line.start) <=
            splitTime
        )

      const rightWords =
        line.words.filter(
          (word) =>
            (word.start ??
              line.end) >=
            splitTime
        )

      if (leftWords.length) {
        leftText =
          leftWords
            .map(
              (word) =>
                word.word ||
                word.text ||
                ''
            )
            .join(' ')
            .trim()
      }

      if (rightWords.length) {
        rightText =
          rightWords
            .map(
              (word) =>
                word.word ||
                word.text ||
                ''
            )
            .join(' ')
            .trim()
      }
    }

    const left = {
      ...line,

      id:
        `split-a-${Date.now()}`,

      text:
        leftText ||
        l.manualSegment,

      start:
        line.start,

      end:
        splitTime,

      words:
        approximateWords(
          leftText ||
            l.manualSegment,
          line.start,
          splitTime
        ),
    }

    const right = {
      ...line,

      id:
        `split-b-${Date.now() + 1}`,

      text:
        rightText ||
        l.manualSegment,

      start:
        splitTime,

      end:
        line.end,

      words:
        approximateWords(
          rightText ||
            l.manualSegment,
          splitTime,
          line.end
        ),
    }

    setLines(
      (current) =>
        current
          .flatMap((item) =>
            item.id === line.id
              ? [left, right]
              : [item]
          )
          .sort(
            (a, b) =>
              a.start -
              b.start
          )
    )

    setTimingId(
      right.id
    )
  }

  function mergeSelectedWithNext() {
    const selected =
      getSelectedLine()

    if (!selected) return

    const sorted =
      [...lines].sort(
        (a, b) =>
          a.start - b.start
      )

    const index =
      sorted.findIndex(
        (line) =>
          line.id ===
          selected.id
      )

    if (
      index < 0 ||
      index >=
        sorted.length - 1
    ) {
      return
    }

    const next =
      sorted[index + 1]

    const mergedText =
      [
        selected.text,
        next.text,
      ]
        .filter(Boolean)
        .join(' ')
        .trim() ||
      l.manualSegment

    const start =
      Math.min(
        selected.start,
        next.start
      )

    const end =
      Math.max(
        selected.end,
        next.end
      )

    const merged = {
      ...selected,

      id:
        `merge-${Date.now()}`,

      text:
        mergedText,

      start,
      end,

      role:
        selected.role ||
        next.role ||
        null,

      words:
        approximateWords(
          mergedText,
          start,
          end
        ),
    }

    setLines(
      sorted
        .filter(
          (line) =>
            line.id !==
              selected.id &&
            line.id !==
              next.id
        )
        .concat(merged)
        .sort(
          (a, b) =>
            a.start -
            b.start
        )
    )

    setTimingId(
      merged.id
    )

    seekVideo(
      merged.start
    )
  }

  function deleteSegment(
    lineId
  ) {
    setLines(
      (current) =>
        current.filter(
          (line) =>
            line.id !== lineId
        )
    )

    if (
      timingId === lineId
    ) {
      setTimingId(null)
    }

    /*
      Removing a segment means it is no longer a
      performance take. When the setup is approved,
      the original scene audio remains for this time.
    */
  }

  function updateTiming(
    lineId,
    nextStart,
    nextEnd
  ) {
    setLines((current) =>
      current
        .map((line) => {
          if (
            line.id !==
            lineId
          ) {
            return line
          }

          let start =
            clampTime(
              nextStart,
              line.start
            )

          let end =
            clampTime(
              nextEnd,
              line.end
            )

          if (
            end <= start
          ) {
            end =
              duration
                ? Math.min(
                    duration,
                    start +
                      0.1
                  )
                : start +
                  0.1
          }

          if (
            end <= start
          ) {
            start =
              Math.max(
                0,
                end -
                  0.1
              )
          }

          return {
            ...line,
            start,
            end,

            words:
              line.text?.trim()
                ? approximateWords(
                    line.text,
                    start,
                    end
                  )
                : [],
          }
        })
        .sort(
          (a, b) =>
            a.start -
            b.start
        )
    )
  }

  function timeFromPointer(
    event,
    trackElement
  ) {
    if (
      !trackElement ||
      !duration
    ) {
      return 0
    }

    const rect =
      trackElement.getBoundingClientRect()

    const ratio =
      Math.min(
        1,
        Math.max(
          0,
          (event.clientX -
            rect.left) /
            rect.width
        )
      )

    return ratio * duration
  }

  function beginSegmentMove(
    event,
    line
  ) {
    /*
      Handles own their pointer events.
      The body of the take moves the WHOLE block.
    */
    if (
      event.target.closest(
        '.dsTrimHandle'
      )
    ) {
      return
    }

    event.preventDefault()
    event.stopPropagation()

    const track =
      event.currentTarget
        .closest(
          '.dsTimelineTrack'
        )

    if (
      !track ||
      !duration
    ) {
      return
    }

    event.currentTarget
      .setPointerCapture?.(
        event.pointerId
      )

    const pointerTime =
      timeFromPointer(
        event,
        track
      )

    setTimingId(
      line.id
    )

    setDraggingHandle({
      lineId: line.id,
      edge: 'move',
      track,

      /*
        Preserve where inside the block the user
        grabbed it, so the take does not jump when
        dragging begins.
      */
      grabOffset:
        pointerTime -
        line.start,

      originalDuration:
        Math.max(
          0.12,
          line.end -
            line.start
        ),
    })
  }

  function beginHandleDrag(
    event,
    line,
    edge
  ) {
    event.preventDefault()
    event.stopPropagation()

    const track =
      event.currentTarget
        .closest(
          '.dsTimelineTrack'
        )

    if (!track) return

    event.currentTarget
      .setPointerCapture?.(
        event.pointerId
      )

    setTimingId(
      line.id
    )

    setDraggingHandle({
      lineId: line.id,
      edge,
      track,
    })
  }

  function moveHandleDrag(
    event
  ) {
    if (
      !draggingHandle
    ) {
      return
    }

    const line =
      lines.find(
        (item) =>
          item.id ===
          draggingHandle.lineId
      )

    if (!line) return

    const time =
      timeFromPointer(
        event,
        draggingHandle.track
      )

    const minimumLength =
      0.12

    if (
      draggingHandle.edge ===
      'move'
    ) {
      const blockDuration =
        draggingHandle
          .originalDuration ||
        Math.max(
          minimumLength,
          line.end -
            line.start
        )

      const grabOffset =
        draggingHandle
          .grabOffset || 0

      let nextStart =
        time -
        grabOffset

      let nextEnd =
        nextStart +
        blockDuration

      /*
        Clamp the full take inside the video while
        preserving its duration.
      */
      if (nextStart < 0) {
        nextStart = 0
        nextEnd =
          blockDuration
      }

      if (
        duration &&
        nextEnd > duration
      ) {
        nextEnd =
          duration

        nextStart =
          Math.max(
            0,
            duration -
              blockDuration
          )
      }

      updateTiming(
        line.id,
        nextStart,
        nextEnd
      )

      setVideoTime(
        Math.min(
          nextEnd,
          Math.max(
            nextStart,
            time
          )
        )
      )

      return
    }

    if (
      draggingHandle.edge ===
      'start'
    ) {
      const nextStart =
        Math.min(
          line.end -
            minimumLength,
          time
        )

      updateTiming(
        line.id,
        nextStart,
        line.end
      )

      setVideoTime(
        Math.max(
          0,
          nextStart
        )
      )
    } else {
      const nextEnd =
        Math.max(
          line.start +
            minimumLength,
          time
        )

      updateTiming(
        line.id,
        line.start,
        nextEnd
      )

      setVideoTime(
        nextEnd
      )
    }
  }

  function endHandleDrag() {
    setDraggingHandle(
      null
    )
  }

  function assignAllToMe() {
    if (readOnly) return

    const role =
      isDuo
        ? 'person-1'
        : 'me'

    setLines(
      (current) =>
        current.map(
          (line) => ({
            ...line,
            role,
          })
        )
    )
  }

  function assignRole(
    lineId,
    role
  ) {
    if (readOnly) return

    setLines((current) =>
      current.map(
        (line) =>
          line.id === lineId
            ? {
                ...line,
                role,
              }
            : line
      )
    )
  }

  function saveEdit(
    lineId,
    text
  ) {
    const clean =
      text.trim()

    if (!clean) return

    setLines((current) =>
      current.map(
        (line) => {
          if (
            line.id !== lineId
          ) {
            return line
          }

          const originalWords =
            line.words || []

          const tokens =
            clean
              .split(/\s+/)
              .filter(Boolean)

          const nextWords =
            originalWords.length ===
            tokens.length
              ? originalWords.map(
                  (
                    word,
                    index
                  ) => ({
                    ...word,
                    word:
                      tokens[index],
                  })
                )
              : approximateWords(
                  clean,
                  line.start,
                  line.end
                )

          return {
            ...line,
            text: clean,
            words: nextWords,
          }
        }
      )
    )

    setEditingId(null)
  }

  function splitLine(
    lineId,
    splitIndex
  ) {
    setLines((current) => {
      const index =
        current.findIndex(
          (line) =>
            line.id === lineId
        )

      if (index === -1) {
        return current
      }

      const line =
        current[index]

      const words =
        line.words?.length
          ? line.words
          : approximateWords(
              line.text,
              line.start,
              line.end
            )

      if (
        splitIndex <= 0 ||
        splitIndex >=
          words.length
      ) {
        return current
      }

      const firstWords =
        words.slice(
          0,
          splitIndex
        )

      const secondWords =
        words.slice(
          splitIndex
        )

      const stamp =
        Date.now()

      const firstLine = {
        ...line,

        id:
          `${line.id}-a-${stamp}`,

        text:
          firstWords
            .map(
              (word) =>
                word.word
            )
            .join(' '),

        start:
          firstWords[0].start,

        end:
          firstWords[
            firstWords.length -
              1
          ].end,

        words:
          firstWords,
      }

      const secondLine = {
        ...line,

        id:
          `${line.id}-b-${stamp}`,

        text:
          secondWords
            .map(
              (word) =>
                word.word
            )
            .join(' '),

        start:
          secondWords[0]
            .start,

        end:
          secondWords[
            secondWords.length -
              1
          ].end,

        words:
          secondWords,
      }

      const next =
        [...current]

      next.splice(
        index,
        1,
        firstLine,
        secondLine
      )

      return next
    })

    setSplittingId(null)
  }

  function mergeWithNext(
    lineId
  ) {
    setLines((current) => {
      const index =
        current.findIndex(
          (line) =>
            line.id === lineId
        )

      if (
        index === -1 ||
        index >=
          current.length - 1
      ) {
        return current
      }

      const first =
        current[index]

      const second =
        current[index + 1]

      const firstWords =
        first.words?.length
          ? first.words
          : approximateWords(
              first.text,
              first.start,
              first.end
            )

      const secondWords =
        second.words?.length
          ? second.words
          : approximateWords(
              second.text,
              second.start,
              second.end
            )

      const sameRole =
        first.role &&
        second.role &&
        first.role ===
          second.role

      const merged = {
        id:
          `merged-${Date.now()}`,

        text:
          `${first.text.trim()} ${second.text.trim()}`.trim(),

        start:
          Math.min(
            first.start,
            second.start
          ),

        end:
          Math.max(
            first.end,
            second.end
          ),

        words: [
          ...firstWords,
          ...secondWords,
        ],

        // إذا الاثنين نفس الدور نحافظ عليه،
        // وإذا مختلفين نخلي المستخدم يختار من جديد.
        role:
          sameRole
            ? first.role
            : null,
      }

      const next =
        [...current]

      next.splice(
        index,
        2,
        merged
      )

      return next
    })

    setEditingId(null)
    setSplittingId(null)
  }

  function continueScene() {
    if (!allAssigned) {
      return
    }

    onContinue?.({
      mode,
      dialogue: lines,

      publish:
        scene?.isUpload
          ? publish
          : false,
    })
  }

  return (
    <section className="dialogueSetupPage">
      <button
        className="dsBackButton"
        onClick={onBack}
      >
        ←
      </button>

      <header className="dsHero">
        <div>
          <span className="dsEyebrow">
            {l.eyebrow}
          </span>

          <h1>
            {l.title}
          </h1>

          <p>
            {l.description}
          </p>
        </div>

        <div className="dsDetectedLanguage">
          {analysis
            ?.transcription
            ?.language
            ?.toUpperCase() ||
            '—'}
        </div>
      </header>

      <section className="dsTimelineEditor">
        <div className="dsTimelineHeader">
          <div>
            <strong>
              {l.timelineTitle}
            </strong>

            <span>
              {l.timelineHelp}
            </span>
          </div>

          
        </div>

        <video
          ref={videoRef}
          src={scene?.videoUrl}
          controls
          className="dsTimelineVideo"
          onLoadedMetadata={(event) => {
            setVideoTime(
              event.currentTarget
                .currentTime || 0
            )
          }}
          onTimeUpdate={(event) =>
            setVideoTime(
              event.currentTarget
                .currentTime
            )
          }
        />

        <div className="dsTimelineToolbar">
          <div className="dsTimelineToolbarLeft">
            <button
              type="button"
              className="dsTimelineTool primary"
              onClick={() =>
                addSegment(
                  videoTime
                )
              }
            >
              <Plus size={14} />
              {l.addSegment}
            </button>

            <button
              type="button"
              className="dsTimelineTool compact"
              onClick={
                assignAllToMe
              }
              title={
                language === 'ar'
                  ? 'تعيين كل المقاطع لي'
                  : 'Assign every segment to me'
              }
            >
              {language === 'ar'
                ? 'الكل لي'
                : 'All to me'}
            </button>

            <button
              type="button"
              className="dsTimelineTool"
              disabled={!timingId}
              onClick={
                splitSelectedAtPlayhead
              }
            >
              <Scissors size={14} />
              {l.split}
            </button>

            <button
              type="button"
              className="dsTimelineTool"
              disabled={!timingId}
              onClick={
                mergeSelectedWithNext
              }
            >
              <GitMerge size={14} />
              {l.merge}
            </button>

            <button
              type="button"
              className="dsTimelineTool danger"
              disabled={!timingId}
              onClick={() => {
                if (!timingId) return

                deleteSegment(
                  timingId
                )
              }}
            >
              <Trash2 size={14} />
              {language === 'ar'
                ? 'حذف'
                : 'Delete'}
            </button>
          </div>

          {timingId && (
            <div className="dsSelectedSegmentInfo">
              {(() => {
                const selected =
                  lines.find(
                    (line) =>
                      line.id ===
                      timingId
                  )

                if (!selected) {
                  return null
                }

                return (
                  <>
                    <span>
                      {language === 'ar'
                        ? 'المقطع المحدد'
                        : 'Selected segment'}
                    </span>

                    <strong>
                      {formatTime(
                        selected.start
                      )}
                      {' — '}
                      {formatTime(
                        selected.end
                      )}
                    </strong>
                  </>
                )
              })()}
            </div>
          )}
        </div>

        <div className="dsTimelineClock">
          <span>
            {formatTime(videoTime)}
          </span>

          <span>
            {formatTime(duration)}
          </span>
        </div>

        <div
          className={`dsTimelineTrack ${
            draggingHandle
              ? 'dragging'
              : ''
          }`}
          onClick={(event) => {
            if (
              draggingHandle ||
              event.target.closest(
                '.dsTimelineSegment'
              )
            ) {
              return
            }

            const time =
              timeFromPointer(
                event,
                event.currentTarget
              )

            seekVideo(time)
          }}
          onDoubleClick={(event) => {
            if (
              event.target.closest(
                '.dsTimelineSegment'
              )
            ) {
              return
            }

            const time =
              timeFromPointer(
                event,
                event.currentTarget
              )

            seekVideo(time)
            addSegment(time)
          }}
          onPointerMove={
            moveHandleDrag
          }
          onPointerUp={
            endHandleDrag
          }
          onPointerCancel={
            endHandleDrag
          }
          onPointerLeave={() => {
            /*
              Do not end the trim just because the pointer
              leaves the visual bar. Pointer capture keeps
              the drag alive, which is especially important
              when extending the END edge forward.
            */
          }}
        >
          {lines.map(
            (line, index) => {
              const safeDuration =
                Math.max(
                  duration,
                  line.end,
                  0.1
                )

              const left =
                (line.start /
                  safeDuration) *
                100

              const width =
                Math.max(
                  0.8,
                  ((line.end -
                    line.start) /
                    safeDuration) *
                    100
                )

              return (
                <button
                  type="button"
                  key={`timeline-${line.id}`}
                  className={`dsTimelineSegment ${
                    timingId ===
                    line.id
                      ? 'active'
                      : ''
                  }`}
                  style={{
                    left:
                      `${left}%`,

                    width:
                      `${width}%`,
                  }}
                  title={`${index + 1} · ${formatTime(
                    line.start
                  )} — ${formatTime(
                    line.end
                  )}`}
                  onPointerDown={(event) =>
                    beginSegmentMove(
                      event,
                      line
                    )
                  }
                  onClick={() => {
                    setTimingId(
                      line.id
                    )

                    /*
                      A simple click still selects the
                      segment. Avoid seeking after a
                      drag, because that makes the block
                      feel like it snaps back.
                    */
                    if (
                      !draggingHandle
                    ) {
                      seekVideo(
                        line.start
                      )
                    }
                  }}
                >
                  <span
                    className={`dsFinalTrimHandle dsFinalTrimStart ${
                      draggingHandle?.lineId === line.id &&
                      draggingHandle?.edge === 'start'
                        ? 'dragging'
                        : ''
                    }`}
                    title={
                      l.start
                    }
                    onPointerDown={(
                      event
                    ) =>
                      beginHandleDrag(
                        event,
                        line,
                        'start'
                      )
                    }
                  >
                    <i />
                  </span>

                  <span className="dsTimelineSegmentLabel">
                    <b>
                      {index + 1}
                    </b>

                    <small>
                      {line.role === 'original'
                        ? 'Original'
                        : line.role === 'person-2'
                          ? 'P2'
                          : line.role === 'person-1'
                            ? 'P1'
                            : line.role
                              ? 'Me'
                              : '—'}
                    </small>
                  </span>

                  <span
                    className={`dsFinalTrimHandle dsFinalTrimEnd ${
                      draggingHandle?.lineId === line.id &&
                      draggingHandle?.edge === 'end'
                        ? 'dragging'
                        : ''
                    }`}
                    title={
                      l.end
                    }
                    onPointerDown={(
                      event
                    ) =>
                      beginHandleDrag(
                        event,
                        line,
                        'end'
                      )
                    }
                  >
                    <i />
                  </span>
                </button>
              )
            }
          )}

          <span
            className="dsTimelinePlayhead"
            style={{
              left:
                `${
                  duration
                    ? Math.min(
                        100,
                        Math.max(
                          0,
                          (videoTime /
                            duration) *
                            100
                        )
                      )
                    : 0
                }%`,
            }}
          />
        </div>

        <div className="dsTimelineUsageHint">
          <span>
            {language === 'ar'
              ? 'اضغط على أي مكان لتحريك المؤشر، واضغط مرتين لإضافة مقطع جديد هناك.'
              : 'Click anywhere to move the playhead. Double-click an empty spot to add a new segment there.'}
          </span>
        </div>

        {!lines.length && (
          <div className="dsNoDialogueHint">
            {l.noDialogueHint}
          </div>
        )}
      </section>

      <div className="dsTopBar">
        <strong>
          {lines.length}{' '}
          {l.lines}
        </strong>

        <span>
          {assignedCount}/
          {lines.length}{' '}
          {l.assigned}
        </span>
      </div>

      <div className="dialogueBlocks">
        {lines.map(
          (line, index) => {
            const isEditing =
              editingId ===
              line.id

            const isSplitting =
              splittingId ===
              line.id

            const textDirection =
              containsArabic(
                line.text
              )
                ? 'rtl'
                : 'ltr'

            return (
              <article
                className={`dialogueBlock ${
                  line.role
                    ? 'assigned'
                    : ''
                }`}
                key={line.id}
              >
                <div className="dialogueBlockTop">
                  <div className="dialogueIndexTime">
                    <span className="dialogueNumber">
                      {String(
                        index + 1
                      ).padStart(
                        2,
                        '0'
                      )}
                    </span>

                    <span className="dialogueTime">
                      {formatTime(
                        line.start
                      )}{' '}
                      —{' '}
                      {formatTime(
                        line.end
                      )}
                    </span>
                  </div>

                  <div className="dialogueActions">
                    <IconButton
                      label={l.edit}
                      active={
                        isEditing
                      }
                      onClick={() =>
                        setEditingId(
                          isEditing
                            ? null
                            : line.id
                        )
                      }
                    >
                      <Pencil
                        size={16}
                      />
                    </IconButton>

                    <IconButton
                      label={l.timing}
                      active={
                        timingId ===
                        line.id
                      }
                      onClick={() =>
                        setTimingId(
                          timingId ===
                          line.id
                            ? null
                            : line.id
                        )
                      }
                    >
                      <Clock3
                        size={16}
                      />
                    </IconButton>

                    <IconButton
                      label={
                        language === 'ar'
                          ? 'حذف المقطع والاعتماد على الصوت الأصلي'
                          : 'Delete segment and keep original audio'
                      }
                      onClick={() =>
                        deleteSegment(
                          line.id
                        )
                      }
                    >
                      <Trash2
                        size={16}
                      />
                    </IconButton>

                    <IconButton
                      label={l.split}
                      active={
                        isSplitting
                      }
                      onClick={() =>
                        setSplittingId(
                          isSplitting
                            ? null
                            : line.id
                        )
                      }
                    >
                      <Scissors
                        size={16}
                      />
                    </IconButton>

                    {index <
                      lines.length -
                        1 && (
                      <IconButton
                        label={
                          l.merge
                        }
                        onClick={() =>
                          mergeWithNext(
                            line.id
                          )
                        }
                      >
                        <GitMerge
                          size={16}
                        />
                      </IconButton>
                    )}
                  </div>
                </div>

                {isEditing ? (
                  <InlineEditor
                    line={line}
                    direction={
                      textDirection
                    }
                    labels={l}
                    onSave={
                      saveEdit
                    }
                    onCancel={() =>
                      setEditingId(
                        null
                      )
                    }
                  />
                ) : (
                  <p
                    className="dialogueText"
                    dir={
                      textDirection
                    }
                  >
                    {line.text}
                  </p>
                )}

                <div className="roleSegmentedControl">
                  {!isDuo && (
                    <RoleOption
                      active={
                        line.role ===
                        'me'
                      }
                      onClick={() =>
                        assignRole(
                          line.id,
                          'me'
                        )
                      }
                    >
                      {l.me}
                    </RoleOption>
                  )}

                  {isDuo && (
                    <>
                      <RoleOption
                        active={
                          line.role ===
                          'person-1'
                        }
                        onClick={() =>
                          assignRole(
                            line.id,
                            'person-1'
                          )
                        }
                      >
                        {
                          person1Label
                        }
                      </RoleOption>

                      <RoleOption
                        active={
                          line.role ===
                          'person-2'
                        }
                        onClick={() =>
                          assignRole(
                            line.id,
                            'person-2'
                          )
                        }
                      >
                        {
                          person2Label
                        }
                      </RoleOption>
                    </>
                  )}

                  <RoleOption
                    active={
                      line.role ===
                      'original'
                    }
                    title={
                      l.originalHint
                    }
                    onClick={() =>
                      assignRole(
                        line.id,
                        'original'
                      )
                    }
                  >
                    <Volume2
                      size={13}
                    />

                    {l.original}
                  </RoleOption>
                </div>

                {timingId ===
                  line.id && (
                  <div className="dsTrimHint">
                    <span>
                      {l.timingTitle}
                    </span>

                    <strong>
                      {formatTime(
                        line.start
                      )}
                      {' — '}
                      {formatTime(
                        line.end
                      )}
                    </strong>

                    <button
                      type="button"
                      onClick={() =>
                        previewLine(
                          line
                        )
                      }
                    >
                      ▶ {l.previewSegment}
                    </button>
                  </div>
                )}

                {isSplitting && (
                  <WordSplitter
                    line={line}
                    direction={
                      textDirection
                    }
                    labels={l}
                    onSplit={(
                      splitIndex
                    ) =>
                      splitLine(
                        line.id,
                        splitIndex
                      )
                    }
                    onClose={() =>
                      setSplittingId(
                        null
                      )
                    }
                  />
                )}
              </article>
            )
          }
        )}
      </div>

      {scene?.isUpload && (
        <div className="dsPublishOption">
          <div>
            <strong>
              {l.publish}
            </strong>

            <span>
              {l.publishText}
            </span>
          </div>

          <button
            type="button"
            className={`dsSwitch ${
              publish
                ? 'on'
                : ''
            }`}
            onClick={() =>
              setPublish(
                (current) =>
                  !current
              )
            }
          >
            <span />
          </button>
        </div>
      )}

      <footer className="dsFooter">
        <div className="dsFooterStatus">
          {allAssigned ? (
            <>
              <Check
                size={16}
              />

              {l.ready}
            </>
          ) : (
            l.remaining
          )}
        </div>

        <button
          type="button"
          className="dsContinueButton"
          disabled={
            !allAssigned ||
            readOnly
          }
          onClick={
            continueScene
          }
        >
          {l.continue}

          <span>→</span>
        </button>
      </footer>
    </section>
  )
}

function RoleOption({
  active,
  title,
  onClick,
  children,
}) {
  return (
    <button
      type="button"
      title={title}
      className={
        active
          ? 'active'
          : ''
      }
      onClick={onClick}
    >
      {children}
    </button>
  )
}

function InlineEditor({
  line,
  direction,
  labels,
  onSave,
  onCancel,
}) {
  const [value, setValue] =
    useState(line.text)

  return (
    <div className="dsInlineEditor">
      <textarea
        dir={direction}
        value={value}
        autoFocus
        onChange={(event) =>
          setValue(
            event.target.value
          )
        }
      />

      <div className="dsEditorActions">
        <button
          type="button"
          onClick={onCancel}
        >
          {labels.cancel}
        </button>

        <button
          type="button"
          className="save"
          onClick={() =>
            onSave(
              line.id,
              value
            )
          }
        >
          {labels.save}
        </button>
      </div>
    </div>
  )
}

function WordSplitter({
  line,
  direction,
  labels,
  onSplit,
  onClose,
}) {
  const words =
    line.words?.length
      ? line.words.map(
          (word) =>
            word.word
        )
      : line.text
          .split(/\s+/)
          .filter(Boolean)

  return (
    <div className="dsWordSplitter">
      <div className="dsSplitHeader">
        <div>
          <Scissors
            size={14}
          />

          <span>
            {labels.splitTitle}
          </span>
        </div>

        <button
          type="button"
          onClick={onClose}
        >
          <X size={15} />
        </button>
      </div>

      <div
        className="dsWords"
        dir={direction}
      >
        {words.map(
          (word, index) => (
            <span
              className="dsWord"
              key={`${word}-${index}`}
            >
              <span>
                {word}
              </span>

              {index <
                words.length -
                  1 && (
                <button
                  type="button"
                  className="dsSplitPoint"
                  aria-label={
                    labels.split
                  }
                  onClick={() =>
                    onSplit(
                      index + 1
                    )
                  }
                >
                  <span />
                </button>
              )}
            </span>
          )
        )}
      </div>

      <p>
        {labels.splitHelp}
      </p>
    </div>
  )
}
