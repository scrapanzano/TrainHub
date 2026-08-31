import { useEffect, useRef } from 'react'
import { Button } from '@mui/material'
import { useMutation } from '@tanstack/react-query'
import { Navigate, useParams } from 'react-router'
import { EmptyState, ErrorState, LoadingState } from '../../components/ScreenState.jsx'
import { mutationKeys } from '../../lib/mutationKeys.js'
import { useAuth } from '../auth/useAuth.js'

export default function ClientChatRedirectScreen() {
  const { clientId } = useParams()
  const { user } = useAuth()
  const createThread = useMutation({ mutationKey: mutationKeys.ensureThread })
  const attempted = useRef(false)

  useEffect(() => {
    if (attempted.current || !clientId || !user?.id) return
    attempted.current = true
    createThread.mutate({ memberId: clientId, proId: user.id })
  }, [clientId, user?.id, createThread])

  if (createThread.data?.id) return <Navigate to={`/p/chat/${createThread.data.id}`} replace />
  if (createThread.isError) {
    return (
      <ErrorState
        error={createThread.error}
        onRetry={() => createThread.mutate({ memberId: clientId, proId: user.id })}
      />
    )
  }
  if (createThread.isPaused) {
    return (
      <EmptyState
        title="Chat saved for later"
        description="You are offline. The conversation will open when you reconnect."
        action={(
          <Button variant="outlined" onClick={() => window.history.back()}>
            Back to client
          </Button>
        )}
      />
    )
  }
  return <LoadingState />
}
