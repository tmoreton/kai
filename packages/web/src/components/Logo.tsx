interface LogoProps {
  className?: string;
}

export function Logo({ className = "w-6 h-6" }: LogoProps) {
  return (
    <svg viewBox="0 0 100 110" className={className} xmlns="http://www.w3.org/2000/svg" shapeRendering="crispEdges">
      <circle cx="50" cy="50" r="50" fill="#5a9e8f" shapeRendering="auto" />
      {/* ">" chevron */}
      <polyline points="38,30 54,44 38,58" fill="none" stroke="white" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" shapeRendering="auto" />
      {/* "_" underscore */}
      <line x1="50" y1="67" x2="70" y2="67" stroke="white" strokeWidth="4" strokeLinecap="round" shapeRendering="auto" />
    </svg>
  );
}
