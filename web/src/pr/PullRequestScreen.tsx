import { useParams } from 'react-router'

/** Placeholder — replaced by the real review screen in Stage 3. */
export function PullRequestScreen() {
  const { projectId, number } = useParams()
  return (
    <main className="p-6 text-zinc-500">
      PR #{number} of project {projectId} — review screen coming soon.
    </main>
  )
}

export default PullRequestScreen
