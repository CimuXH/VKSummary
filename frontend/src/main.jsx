import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

// Error boundary to catch runtime errors
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }
  static getDerivedStateFromError(error) {
    return { error }
  }
  componentDidCatch(error, info) {
    console.error('React error:', error, info)
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{
          padding: '40px',
          margin: '40px',
          background: '#fff',
          border: '2px solid #e05548',
          fontFamily: 'monospace',
          fontSize: '14px',
          lineHeight: 1.6,
        }}>
          <h1 style={{ color: '#e05548', marginBottom: '16px' }}>⚠️ React Render Error</h1>
          <p style={{ fontWeight: 'bold', marginBottom: '8px' }}>{this.state.error.message}</p>
          <pre style={{
            background: '#f5f5f5',
            padding: '16px',
            overflow: 'auto',
            maxHeight: '400px',
            fontSize: '12px',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
          }}>
            {this.state.error.stack}
          </pre>
        </div>
      )
    }
    return this.props.children
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
)
