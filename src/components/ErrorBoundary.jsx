import { Component } from 'react'

/**
 * Top-level error boundary. Catches uncaught render errors so a buggy chart
 * or a malformed MQTT payload doesn't take the whole dashboard to a blank
 * screen. Surfaces a "Message Sandy Soil" path so the customer always has
 * an exit even if the app is broken.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null, info: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary] uncaught render error:', error, info)
    this.setState({ info })
  }

  reset = () => this.setState({ error: null, info: null })

  render() {
    if (!this.state.error) return this.props.children

    return (
      <div className="min-h-screen bg-[#fafbfa] flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white rounded-2xl border border-[#e4e9e6] p-7 text-center">
          <div className="w-14 h-14 mx-auto rounded-full bg-[#fce8e6] text-[#a8281e] flex items-center justify-center mb-4">
            <span className="material-symbols-outlined" style={{ fontSize: 28 }}>error</span>
          </div>
          <h1 className="font-headline font-bold text-xl text-[#0e1f1a]">Something went wrong</h1>
          <p className="text-sm text-[#3b4a44] mt-2 leading-relaxed">
            The dashboard hit an unexpected error. Your zones and schedules are still
            running on the controller — this is just a display issue.
          </p>
          <p className="text-[11px] text-[#7a8580] mt-3 font-mono break-words">
            {String(this.state.error?.message ?? this.state.error)}
          </p>
          <div className="flex gap-2 mt-5">
            <button
              onClick={() => window.location.reload()}
              className="flex-1 py-2.5 rounded-xl bg-[#0d4d20] text-white font-bold text-sm hover:opacity-90 transition-opacity"
            >
              Reload
            </button>
            <a
              href="mailto:mandeep@freshoz.com?subject=Dashboard%20Error"
              className="flex-1 py-2.5 rounded-xl bg-[#f3f3f3] text-[#0e1f1a] font-bold text-sm text-center hover:bg-[#e8e8e8] transition-colors"
            >
              Message support
            </a>
          </div>
        </div>
      </div>
    )
  }
}
