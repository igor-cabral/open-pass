import { Icon } from './Icon'

export function EmptyState({ title, description }: { title: string; description?: string }) {
  return (
    <div className="text-center py-16 px-4">
      <div className="mx-auto mb-4 h-16 w-16 rounded-3xl bg-primary-light flex items-center justify-center text-primary animate-pop-in">
        <Icon name="ticket" className="h-8 w-8" />
      </div>
      <h3 className="font-display font-semibold text-lg">{title}</h3>
      {description && <p className="text-ink/60 text-sm mt-1 max-w-sm mx-auto">{description}</p>}
    </div>
  )
}
