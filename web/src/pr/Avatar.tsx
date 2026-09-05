import type { Actor } from '@coja/shared/api'

interface AvatarProps {
  actor: Actor
  size?: number
  className?: string
}

/** GitHub avatar with an initial-letter fallback. Decorative: the login is always rendered next to it. */
export function Avatar({ actor, size = 20, className = '' }: AvatarProps) {
  if (actor.avatarUrl) {
    return (
      <img
        src={actor.avatarUrl}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        className={`shrink-0 rounded-full bg-active ${className}`}
      />
    )
  }
  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size, fontSize: Math.max(9, Math.round(size * 0.5)) }}
      className={`inline-flex shrink-0 items-center justify-center rounded-full bg-active font-semibold text-ink ${className}`}
    >
      {actor.login.slice(0, 1).toUpperCase()}
    </span>
  )
}
