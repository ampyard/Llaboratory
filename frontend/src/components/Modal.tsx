export default function Modal({
  onClose,
  maxWidth = 'max-w-lg',
  children,
}: {
  onClose: () => void
  maxWidth?: string
  children: React.ReactNode
}) {
  return (
    <div
      className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className={`bg-white rounded-2xl shadow-xl w-full ${maxWidth} p-6`}
        onClick={e => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  )
}
