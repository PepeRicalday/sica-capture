import React from 'react';

interface RepresoSchemaProps {
    pzasRadiales: number;
    anchoRadial: number;
    altoRadial?: number;
    aperturas: number[]; // en metros (valores reales divididos entre 100)
    nivelArriba: number; // en metros
    activeGateIndex: number;
    onGateSelect: (index: number) => void;
}

export const RepresoSchema: React.FC<RepresoSchemaProps> = ({
    pzasRadiales,
    anchoRadial,
    altoRadial = 2.0, // Altura estimada si no está provista
    aperturas,
    nivelArriba,
    activeGateIndex,
    onGateSelect
}) => {
    // Canvas Dinámico
    const W = Math.max(480, pzasRadiales * 120 + 80);
    const H = 260;

    // Altura relativa
    const maxVal = Math.max(altoRadial * 1.5, nivelArriba * 1.5, 3.0);
    const pxPerMeter = 140 / maxVal;

    const baseLine = 220;
    const gateWidth = W / (pzasRadiales + 1);
    const pillarWidth = gateWidth * 0.15;
    const effectiveGateWidth = gateWidth - pillarWidth;

    const startX = (W - (pzasRadiales * gateWidth + pillarWidth)) / 2;

    const waterY = baseLine - (nivelArriba * pxPerMeter);

    return (
        <div className="bg-slate-950 border border-slate-800 rounded-2xl p-4 mb-4 select-none shadow-2xl overflow-x-auto custom-scrollbar">
            <h3 className="text-[11px] text-mobile-accent font-black uppercase tracking-widest mb-4 flex justify-between items-center px-1">
                <span className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-mobile-accent animate-pulse" />
                    Hidro-Perfil de Represo ({pzasRadiales} Radiales)
                </span>
                <span className="text-slate-600 font-bold bg-slate-900 px-2 py-0.5 rounded text-[9px]">SISTEMA MÉTRICO</span>
            </h3>

            <div className="relative w-full overflow-hidden flex justify-center py-4 bg-slate-900/30 rounded-xl min-w-[320px]">
                <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-full" style={{ overflow: 'visible', maxHeight: '180px' }}>
                    <defs>
                        <linearGradient id="waterGradRep" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#0ea5e9" stopOpacity="0.3" />
                            <stop offset="100%" stopColor="#0284c7" stopOpacity="0.7" />
                        </linearGradient>
                        <filter id="glow">
                            <feGaussianBlur stdDeviation="2" result="coloredBlur" />
                            <feMerge>
                                <feMergeNode in="coloredBlur" />
                                <feMergeNode in="SourceGraphic" />
                            </feMerge>
                        </filter>
                    </defs>

                    {/* Agua Retenida (Fondo) */}
                    {nivelArriba > 0 && (
                        <rect
                            x={startX}
                            y={Math.max(40, waterY)}
                            width={pzasRadiales * gateWidth + pillarWidth}
                            height={baseLine - Math.max(40, waterY)}
                            fill="url(#waterGradRep)"
                        />
                    )}

                    <line x1={0} y1={waterY} x2={W} y2={waterY} stroke="#38bdf8" strokeWidth="2" strokeDasharray="5 3" opacity={0.6} />
                    <text x={20} y={waterY - 8} fill="#38bdf8" fontSize="10" fontWeight="bold">Nivel: {nivelArriba.toFixed(2)}m</text>

                    {/* Piso Base */}
                    <rect x={0} y={baseLine} width={W} height={H - baseLine} fill="#1e293b" />
                    <line x1={0} y1={baseLine} x2={W} y2={baseLine} stroke="#475569" strokeWidth="4" />

                    {/* Pilares y Compuertas */}
                    {Array.from({ length: pzasRadiales + 1 }).map((_, i) => {
                        const px = startX + i * gateWidth;
                        return (
                            <g key={`pillar-${i}`}>
                                {/* Pilar */}
                                <rect
                                    x={px}
                                    y={40}
                                    width={pillarWidth}
                                    height={baseLine - 40}
                                    fill="#334155"
                                    stroke="#0f172a"
                                    strokeWidth="2"
                                />

                                {/* Compuerta Radial (si no es el último pilar) */}
                                {i < pzasRadiales && (() => {
                                    const ap = aperturas[i] || 0;
                                    const gateX = px + pillarWidth;
                                    const gatePxH = altoRadial * pxPerMeter;
                                    const liftPx = ap * pxPerMeter;
                                    const isActive = activeGateIndex === i;

                                    return (
                                        <g
                                            key={`gate-${i}`}
                                            onClick={() => onGateSelect(i)}
                                            className="cursor-pointer transition-all hover:opacity-90"
                                        >
                                            {/* El hueco de la compuerta */}
                                            {ap > 0 && (
                                                <rect
                                                    x={gateX + 2}
                                                    y={baseLine - liftPx}
                                                    width={effectiveGateWidth - 4}
                                                    height={liftPx}
                                                    fill="#0ea5e9"
                                                    opacity="0.8"
                                                />
                                            )}

                                            {/* Chapa de la Compuerta Radial */}
                                            <rect
                                                x={gateX}
                                                y={baseLine - gatePxH - liftPx}
                                                width={effectiveGateWidth}
                                                height={gatePxH}
                                                fill={isActive ? '#fbbf24' : '#64748b'}
                                                stroke={isActive ? '#f59e0b' : '#475569'}
                                                strokeWidth="2"
                                                rx="4"
                                            />

                                            {/* Marco / Estructura Cruzada */}
                                            <line
                                                x1={gateX}
                                                y1={baseLine - gatePxH - liftPx}
                                                x2={gateX + effectiveGateWidth}
                                                y2={baseLine - liftPx}
                                                stroke="#0f172a" strokeWidth="2" opacity="0.3"
                                            />
                                            <line
                                                x1={gateX}
                                                y1={baseLine - liftPx}
                                                x2={gateX + effectiveGateWidth}
                                                y2={baseLine - gatePxH - liftPx}
                                                stroke="#0f172a" strokeWidth="2" opacity="0.3"
                                            />

                                            {/* Número de Radial */}
                                            <rect x={gateX + effectiveGateWidth / 2 - 12} y={baseLine - gatePxH - liftPx + 5} width="24" height="14" rx="3" fill="#0f172a" />
                                            <text x={gateX + effectiveGateWidth / 2} y={baseLine - gatePxH - liftPx + 15} textAnchor="middle" fill="#fff" fontSize="10" fontWeight="bold">R{i + 1}</text>

                                            {/* Etiqueta de Apertura */}
                                            <text
                                                x={gateX + effectiveGateWidth / 2}
                                                y={baseLine - (liftPx / 2) + 4}
                                                textAnchor="middle"
                                                fill={isActive ? '#fff' : '#0ea5e9'}
                                                fontSize="12"
                                                fontWeight="900"
                                                filter={isActive ? 'url(#glow)' : ''}
                                            >
                                                {ap.toFixed(2)}m
                                            </text>

                                            {/* Borde activo brillante */}
                                            {isActive && (
                                                <rect
                                                    x={gateX - 2}
                                                    y={baseLine - gatePxH - liftPx - 2}
                                                    width={effectiveGateWidth + 4}
                                                    height={gatePxH + 4}
                                                    fill="none"
                                                    stroke="#fcd34d"
                                                    strokeWidth="3"
                                                    rx="6"
                                                    style={{ filter: 'drop-shadow(0 0 4px #fbbf24)' }}
                                                    className="animate-pulse"
                                                />
                                            )}
                                        </g>
                                    );
                                })()}
                            </g>
                        );
                    })}

                    {/* Ancho Etiqueta */}
                    <line x1={startX + pillarWidth} y1={baseLine + 20} x2={startX + pillarWidth + effectiveGateWidth} y2={baseLine + 20} stroke="#94a3b8" strokeDasharray="4 2" />
                    <text x={startX + pillarWidth + effectiveGateWidth / 2} y={baseLine + 32} textAnchor="middle" fill="#94a3b8" fontSize="10">
                        {anchoRadial}m
                    </text>
                </svg>
            </div>
        </div>
    );
};
