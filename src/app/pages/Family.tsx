// Семейная подписка: экран есть только в проектах с переопределением (FGN — projects/fgn/app/pages/Family.tsx).
import { Navigate } from "react-router-dom";

export default function Family() {
  return <Navigate to="/" replace />;
}
