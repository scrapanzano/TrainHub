import { useRef, useState } from 'react'
import {
  Alert, Avatar, Badge, Box, Button, Drawer, IconButton, Stack, Typography,
} from '@mui/material'
import PhotoCameraIcon from '@mui/icons-material/PhotoCamera'
import { useMutation } from '@tanstack/react-query'
import { mutationKeys } from '../../lib/mutationKeys.js'

/** Longest edge of the stored image, in pixels. */
const MAX_EDGE = 512
/** Anything larger than this is refused before it is even decoded. */
const MAX_INPUT_BYTES = 12 * 1024 * 1024

/**
 * Shrink a chosen photo to something worth storing.
 *
 * Phone cameras produce 4-12 MB files, and this is displayed at 112 px. Sending
 * the original would cost the member their data allowance to upload and cost
 * every later screen the same download. Re-encoded as JPEG because a
 * transparent PNG has nothing to be transparent against here.
 *
 * `createImageBitmap` applies the file's EXIF orientation, which a plain
 * `<img>` would not -- without it, portrait photos from an iPhone arrive
 * sideways.
 */
async function shrink(file) {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height))
  const width = Math.round(bitmap.width * scale)
  const height = Math.round(bitmap.height * scale)

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  canvas.getContext('2d').drawImage(bitmap, 0, 0, width, height)
  bitmap.close()

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('The image could not be processed.'))),
      'image/jpeg',
      0.85,
    )
  })
}

/**
 * The profile photo, and the way to change it.
 *
 * The avatar was a static circle showing an initial, with no hint that it could
 * be anything else -- while `profiles.avatar_url` had been in the schema, read
 * on six screens and writable since patch 015, all along.
 *
 * Deliberately not offline-capable, and enforced as such: both writes are
 * registered `networkMode: 'always'` in `src/data/mutations.js`, so they fail
 * rather than queue. The `navigator.onLine` guards below only catch being
 * offline at the moment of the tap; without that registration a connection
 * dropping mid-upload would park the write, and the persister would replay it
 * later with a `Blob` that `JSON.stringify` had flattened to `{}`.
 *
 * Everything else in this app queues and replays. A queued photo would sit in
 * IndexedDB with no way for the member to see whether it had been sent, and the
 * fallback -- an initial in a circle -- costs them nothing in the meantime.
 *
 * @param {object}  props
 * @param {string}  props.userId
 * @param {?string} props.avatarUrl
 * @param {?string} props.fullName  Supplies the fallback initial.
 */
export default function AvatarPicker({ userId, avatarUrl, fullName }) {
  const fileRef = useRef(null)
  const [open, setOpen] = useState(false)
  const [error, setError] = useState(null)
  const [working, setWorking] = useState(false)

  const upload = useMutation({ mutationKey: mutationKeys.uploadAvatar })
  const clear = useMutation({ mutationKey: mutationKeys.clearAvatar })

  const busy = working || upload.isPending || clear.isPending

  const onPick = async (event) => {
    const file = event.target.files?.[0]
    // Reset immediately: picking the same file twice in a row fires no change
    // event otherwise, so a failed upload could not be retried with the same
    // photo.
    event.target.value = ''
    if (!file) return

    setError(null)

    if (!navigator.onLine) {
      setError('You are offline. A photo can only be uploaded once you reconnect.')
      return
    }
    if (file.size > MAX_INPUT_BYTES) {
      setError('That image is too large. Pick one under 12 MB.')
      return
    }

    setWorking(true)
    try {
      const blob = await shrink(file)
      await upload.mutateAsync({ userId, blob })
      setOpen(false)
    } catch (cause) {
      setError(cause?.message ?? 'The photo could not be uploaded.')
    } finally {
      setWorking(false)
    }
  }

  const onRemove = async () => {
    setError(null)
    if (!navigator.onLine) {
      setError('You are offline. The photo can only be removed once you reconnect.')
      return
    }
    try {
      await clear.mutateAsync({ userId })
      setOpen(false)
    } catch (cause) {
      setError(cause?.message ?? 'The photo could not be removed.')
    }
  }

  return (
    <>
      <IconButton
        onClick={() => {
          setError(null)
          setOpen(true)
        }}
        aria-label={avatarUrl ? 'Change your profile photo' : 'Add a profile photo'}
        sx={{ p: 0 }}
      >
        {/* The camera badge is the only thing telling the member this circle
            does anything at all. */}
        <Badge
          overlap="circular"
          anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
          badgeContent={
            <Box
              sx={{
                width: 32, height: 32, borderRadius: '50%',
                bgcolor: 'primary.main', color: 'primary.contrastText',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                border: 2, borderColor: 'background.default',
              }}
            >
              <PhotoCameraIcon sx={{ fontSize: 17 }} />
            </Box>
          }
        >
          <Avatar src={avatarUrl ?? undefined} sx={{ width: 112, height: 112, fontSize: 40 }}>
            {fullName?.[0] ?? '?'}
          </Avatar>
        </Badge>
      </IconButton>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        onChange={onPick}
        hidden
      />

      {/* Dismissable even mid-upload. The write is registered `networkMode:
          'always'`, so it always settles -- but a sheet that cannot be closed
          while something is in flight is a trap the moment anything is slow,
          and closing it does not cancel the upload. */}
      <Drawer anchor="bottom" open={open} onClose={() => setOpen(false)}>
        <Stack spacing={2} sx={{ p: 3 }}>
          <Typography variant="h2">Profile photo</Typography>

          {error ? <Alert severity="error">{error}</Alert> : null}

          <Button
            variant="contained"
            size="large"
            fullWidth
            disabled={busy}
            onClick={() => fileRef.current?.click()}
          >
            {busy ? 'Uploading…' : avatarUrl ? 'Choose a new photo' : 'Choose a photo'}
          </Button>

          {avatarUrl ? (
            <Button
              variant="outlined"
              color="error"
              size="large"
              fullWidth
              disabled={busy}
              onClick={onRemove}
            >
              Remove photo
            </Button>
          ) : null}

          <Button fullWidth onClick={() => setOpen(false)}>
            Cancel
          </Button>
        </Stack>
      </Drawer>
    </>
  )
}
