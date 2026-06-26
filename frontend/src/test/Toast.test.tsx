import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ToastContainer, useToast } from '../components/Toast'

function TestComponent() {
  const { toasts, showToast, closeToast } = useToast()
  return (
    <div>
      <ToastContainer toasts={toasts} onClose={closeToast} />
      <button onClick={() => showToast('success', 'Success message')}>
        Show Success
      </button>
      <button onClick={() => showToast('error', 'Error message')}>
        Show Error
      </button>
      <button onClick={() => showToast('success', 'Custom duration', 1000)}>
        Show Custom Duration
      </button>
    </div>
  )
}

test('renders success toast', async () => {
  const user = userEvent.setup()
  render(<TestComponent />)

  await user.click(screen.getByText('Show Success'))

  expect(screen.getByText('Success message')).toBeInTheDocument()
})

test('renders error toast', async () => {
  const user = userEvent.setup()
  render(<TestComponent />)

  await user.click(screen.getByText('Show Error'))

  expect(screen.getByText('Error message')).toBeInTheDocument()
})

test('success toast has green styling', async () => {
  const user = userEvent.setup()
  render(<TestComponent />)

  await user.click(screen.getByText('Show Success'))

  const toast = screen.getByText('Success message').closest('div')
  expect(toast).toHaveClass('bg-green-50')
  expect(toast).toHaveClass('border-green-200')
  expect(toast).toHaveClass('text-green-800')
})

test('error toast has red styling', async () => {
  const user = userEvent.setup()
  render(<TestComponent />)

  await user.click(screen.getByText('Show Error'))

  const toast = screen.getByText('Error message').closest('div')
  expect(toast).toHaveClass('bg-red-50')
  expect(toast).toHaveClass('border-red-200')
  expect(toast).toHaveClass('text-red-800')
})

test('can close toast by clicking close button', async () => {
  const user = userEvent.setup()
  render(<TestComponent />)

  await user.click(screen.getByText('Show Success'))
  expect(screen.getByText('Success message')).toBeInTheDocument()

  const closeButton = screen.getByRole('button', { name: '' })
  await user.click(closeButton)

  expect(screen.queryByText('Success message')).not.toBeInTheDocument()
})

test('toast auto-dismisses after duration', async () => {
  render(<TestComponent />)

  const user = userEvent.setup()
  await user.click(screen.getByText('Show Custom Duration'))

  expect(screen.getByText('Custom duration')).toBeInTheDocument()

  await waitFor(
    () => {
      expect(screen.queryByText('Custom duration')).not.toBeInTheDocument()
    },
    { timeout: 1500 }
  )
})

test('can show multiple toasts at once', async () => {
  const user = userEvent.setup()
  render(<TestComponent />)

  await user.click(screen.getByText('Show Success'))
  await user.click(screen.getByText('Show Error'))

  expect(screen.getByText('Success message')).toBeInTheDocument()
  expect(screen.getByText('Error message')).toBeInTheDocument()
})
