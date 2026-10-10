import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'

interface RootErrorBoundaryState {
  hasError: boolean
}

class RootErrorBoundary extends React.Component<{ children: React.ReactNode }, RootErrorBoundaryState> {
  state: RootErrorBoundaryState = { hasError: false }

  static getDerivedStateFromError(): RootErrorBoundaryState {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('Radar Laboral no pudo mostrar esta pantalla.', error, info.componentStack)
  }

  render(): React.ReactNode {
    if (this.state.hasError) {
      return (
        <div style={{ display: 'grid', minHeight: '100vh', placeItems: 'center', padding: 24 }} role="alert">
          <div style={{ maxWidth: 480, textAlign: 'center' }}>
            <h1>Algo salió mal al mostrar esta pantalla.</h1>
            <p>Tus datos siguen guardados en esta computadora. Probá recargar la aplicación.</p>
            <button type="button" onClick={() => window.location.reload()}>Recargar</button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RootErrorBoundary>
      <App />
    </RootErrorBoundary>
  </React.StrictMode>,
)
