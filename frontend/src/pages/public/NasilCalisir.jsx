import { Component, Suspense, lazy, useMemo, useState } from 'react';
import Tanitim from './Tanitim';
import Loading from '../../components/Loading';
import { isLowEndDevice, webglAvailable } from '../../utils/webgl';
import { prefersReducedMotion } from '../../utils/motion';

// three.js sahnesi yalnızca gerektiğinde indirilir
const Tanitim3D = lazy(() => import('./Tanitim3D'));

class Boundary extends Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(err) {
    this.props.onError?.(err);
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

/**
 * "Nasıl çalışır?" — WebGL varsa kaydırmalı 3D anlatım; yoksa, hareket azaltılmışsa
 * ya da düşük donanımlı cihazda sade (2D) anlatım.
 */
export default function NasilCalisir() {
  const can3d = useMemo(() => webglAvailable() && !prefersReducedMotion() && !isLowEndDevice(), []);
  const [failed, setFailed] = useState(false);
  if (!can3d || failed) return <Tanitim />;
  return (
    <Boundary onError={() => setFailed(true)}>
      <Suspense fallback={<Loading text="3D anlatım yükleniyor…" />}>
        <Tanitim3D onFail={() => setFailed(true)} />
      </Suspense>
    </Boundary>
  );
}
