import type { SVGProps } from 'react'

type Props = SVGProps<SVGSVGElement>

function IconBase({ children, ...props }: Props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      {children}
    </svg>
  )
}

export const GitCommitIcon = (props: Props) => (
  <IconBase {...props}>
    <circle cx="12" cy="12" r="3" />
    <path d="M3 12h6M15 12h6" />
  </IconBase>
)

export const MenuIcon = (props: Props) => (
  <IconBase {...props}>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </IconBase>
)

export const FolderPlusIcon = (props: Props) => (
  <IconBase {...props}>
    <path d="M3 6h6l2 2h10v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    <path d="M12 11v6M9 14h6" />
  </IconBase>
)

export const SettingsIcon = (props: Props) => (
  <IconBase {...props}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.6v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1z" />
  </IconBase>
)

export const CloseIcon = (props: Props) => (
  <IconBase {...props}>
    <path d="M6 6l12 12M18 6 6 18" />
  </IconBase>
)

export const ChevronIcon = (props: Props) => (
  <IconBase {...props}>
    <path d="m9 18 6-6-6-6" />
  </IconBase>
)

export const TrashIcon = (props: Props) => (
  <IconBase {...props}>
    <path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5" />
  </IconBase>
)

export const CheckIcon = (props: Props) => (
  <IconBase {...props}>
    <path d="m5 12 4 4L19 6" />
  </IconBase>
)

export const PlayIcon = (props: Props) => (
  <IconBase {...props}>
    <path d="m8 5 11 7-11 7z" />
  </IconBase>
)

export const EyeOffIcon = (props: Props) => (
  <IconBase {...props}>
    <path d="m3 3 18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 4.2A11.4 11.4 0 0 1 12 4c5 0 9 4.8 10 8a13 13 0 0 1-2 3.7M6.2 6.2C4 7.7 2.6 10 2 12c1 3.2 5 8 10 8 1.4 0 2.7-.4 3.8-1" />
  </IconBase>
)

export const PowerIcon = (props: Props) => (
  <IconBase {...props}>
    <path d="M12 2v10M6.3 5.7a8 8 0 1 0 11.4 0" />
  </IconBase>
)

export const RefreshIcon = (props: Props) => (
  <IconBase {...props}>
    <path d="M20 7v5h-5M4 17v-5h5" />
    <path d="M6.1 8A7 7 0 0 1 18.5 6L20 12M4 12l1.5 6A7 7 0 0 0 18 16" />
  </IconBase>
)
