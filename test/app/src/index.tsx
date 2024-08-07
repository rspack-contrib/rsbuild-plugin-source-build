import { Card } from '@e2e/source-build-components';
import ReactDOM from 'react-dom/client';

const rootElement = document.getElementById('root');

if (rootElement) {
  const root = ReactDOM.createRoot(rootElement);
  const App = () => (
    <div className="container">
      <main>
        <Card title="App" content="hello world" />
      </main>
    </div>
  );

  root.render(<App />);
}
