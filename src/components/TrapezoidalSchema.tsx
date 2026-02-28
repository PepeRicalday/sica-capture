import React from 'react';
import clsx from 'clsx';

interface TrapezoidalSchemaProps {
    dobelasCount: number;
    activeDobelaIndex?: number;
    activeTirante?: number; // Tirante de la vertical activa
    activeX?: number;       // Progresiva de la vertical activa

    // Dimensiones de diseño para el esquema completo
    plantilla?: number;
    talud?: number;
    tiranteDiseno?: number;
    espejoDiseno?: number;

    onDobelaSelect?: (index: number) => void;
}

export const TrapezoidalSchema: React.FC<TrapezoidalSchemaProps> = ({
    dobelasCount,
    activeDobelaIndex = -1,
    activeTirante = 0,
    activeX = 0,
    plantilla = 0,
    talud = 0,
    tiranteDiseno = 0,
    espejoDiseno = 0,
    onDobelaSelect
}) => {
    // Vista panorámica técnica ampliada (+15% de escala visual y optimización de espacio)
    const W = 460;
    const H = 300;

    // Coordenadas base para sección completa (Incrementadas en escala para mayor detalle)
    const leftCrownX = 40;
    const leftBottomX = 130;
    const rightBottomX = 330;
    const rightCrownX = 420;
    const crownY = 50;
    const bottomY_val = 210;
    const waterLevelY = 90;

    // Ancho del espejo visual en el dibujo
    const totalVisualEspejoWidth = (rightCrownX - (rightCrownX - rightBottomX) * 0.4) - (leftCrownX + (leftBottomX - leftCrownX) * 0.4);

    // Calculamos las X para cada vertical (dobela) de forma EQUIDISTANTE (Ancho uniforme)
    const dobelas = Array.from({ length: dobelasCount }).map((_, i) => {
        // En aforos, las dobelas deben distribuirse uniformemente en el espejo real.
        // Visualmente las centraremos en la base para una representación técnica limpia.
        const minX = leftBottomX;
        const maxX = rightBottomX;
        const width = maxX - minX;

        let cx = 0;
        if (dobelasCount === 1) {
            cx = (leftBottomX + rightBottomX) / 2;
        } else {
            // Distribución perfectamente uniforme de las verticales
            const step = width / (dobelasCount + 1);
            cx = minX + (step * (i + 1));
        }

        let currentBottomY = bottomY_val;
        if (cx < leftBottomX) {
            const m = (bottomY_val - crownY) / (leftBottomX - leftCrownX);
            currentBottomY = crownY + m * (cx - leftCrownX);
        } else if (cx > rightBottomX) {
            const m = (crownY - bottomY_val) / (rightCrownX - rightBottomX);
            currentBottomY = bottomY_val + m * (cx - rightBottomX);
        }

        return { cx, topY: waterLevelY, bottomY: currentBottomY };
    });

    return (
        <div className="bg-slate-950 border border-slate-800 rounded-2xl p-4 mb-4 select-none shadow-2xl">
            <h3 className="text-[11px] text-mobile-accent font-black uppercase tracking-widest mb-4 flex justify-between items-center px-1">
                <span className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-mobile-accent animate-pulse" />
                    Gemelo Digital Hidráulico (Escala +15%)
                </span>
                <span className="text-slate-600 font-bold bg-slate-900 px-2 py-0.5 rounded text-[9px]">SISTEMA MÉTRICO</span>
            </h3>

            <div className="relative w-full overflow-hidden flex justify-center py-4 bg-slate-900/30 rounded-xl">
                <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-md" style={{ overflow: 'visible' }}>
                    <defs>
                        <linearGradient id="waterGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#0ea5e9" stopOpacity="0.15" />
                            <stop offset="100%" stopColor="#0284c7" stopOpacity="0.45" />
                        </linearGradient>
                        <filter id="glow">
                            <feGaussianBlur stdDeviation="2" result="coloredBlur" />
                            <feMerge>
                                <feMergeNode in="coloredBlur" />
                                <feMergeNode in="SourceGraphic" />
                            </feMerge>
                        </filter>
                    </defs>

                    {/* Estructura del Canal (Polyline técnica reforzada) */}
                    <polyline
                        points={`${leftCrownX - 30},${crownY} ${leftCrownX},${crownY} ${leftBottomX},${bottomY_val} ${rightBottomX},${bottomY_val} ${rightCrownX},${crownY} ${rightCrownX + 30},${crownY}`}
                        fill="none"
                        stroke="#1e293b"
                        strokeWidth="6"
                        strokeLinejoin="round"
                        strokeLinecap="round"
                    />

                    {/* Masa de Agua */}
                    <polygon
                        points={`${leftCrownX + (leftBottomX - leftCrownX) * 0.4},${waterLevelY} ${rightCrownX - (rightCrownX - rightBottomX) * 0.4},${waterLevelY} ${rightBottomX},${bottomY_val} ${leftBottomX},${bottomY_val}`}
                        fill="url(#waterGrad)"
                    />

                    {/* DIMENSIONES TÉCNICAS (Optimizadas para evitar encimamiento) */}

                    {/* 1. Espejo T (Superior Extremo) */}
                    <g className="dimension-group">
                        <line x1={leftCrownX + (leftBottomX - leftCrownX) * 0.4} y1={waterLevelY - 25} x2={rightCrownX - (rightCrownX - rightBottomX) * 0.4} y2={waterLevelY - 25} stroke="#0ea5e9" strokeWidth="1" strokeDasharray="4 2" />
                        <text x={W / 2} y={waterLevelY - 35} fill="#0ea5e9" fontSize="10" fontWeight="900" textAnchor="middle" filter="url(#glow)">
                            T = {espejoDiseno?.toFixed(2)} m (ESPEJO TOTAL)
                        </text>
                        <line x1={leftCrownX + (leftBottomX - leftCrownX) * 0.4} y1={waterLevelY - 32} x2={leftCrownX + (leftBottomX - leftCrownX) * 0.4} y2={waterLevelY - 18} stroke="#38bdf8" strokeWidth="2" />
                        <line x1={rightCrownX - (rightCrownX - rightBottomX) * 0.4} y1={waterLevelY - 32} x2={rightCrownX - (rightCrownX - rightBottomX) * 0.4} y2={waterLevelY - 18} stroke="#38bdf8" strokeWidth="2" />
                    </g>

                    {/* 2. Plantilla b (Inferior Extremo) */}
                    <g className="dimension-group">
                        <line x1={leftBottomX} y1={bottomY_val + 35} x2={rightBottomX} y2={bottomY_val + 35} stroke="#475569" strokeWidth="1" strokeDasharray="4 2" />
                        <text x={W / 2} y={bottomY_val + 50} fill="#94a3b8" fontSize="10" fontWeight="900" textAnchor="middle">
                            b = {plantilla?.toFixed(2)} m (PLANTILLA)
                        </text>
                        <line x1={leftBottomX} y1={bottomY_val + 28} x2={leftBottomX} y2={bottomY_val + 42} stroke="#475569" strokeWidth="2" />
                        <line x1={rightBottomX} y1={bottomY_val + 28} x2={rightBottomX} y2={bottomY_val + 42} stroke="#475569" strokeWidth="2" />
                    </g>

                    {/* 3. Tirante y (Margen Izquierdo, totalmente fuera) */}
                    <g className="dimension-group">
                        <line x1={leftCrownX - 15} y1={waterLevelY} x2={leftCrownX - 15} y2={bottomY_val} stroke="#0ea5e9" strokeWidth="1" strokeDasharray="4 2" />
                        <text x={leftCrownX - 25} y={(waterLevelY + bottomY_val) / 2} fill="#38bdf8" fontSize="11" fontWeight="900" textAnchor="end" dominantBaseline="middle" filter="url(#glow)">
                            y = {tiranteDiseno?.toFixed(2)} m
                        </text>
                        <line x1={leftCrownX - 25} y1={waterLevelY} x2={leftCrownX - 5} y2={waterLevelY} stroke="#0ea5e9" strokeWidth="2" />
                        <line x1={leftCrownX - 25} y1={bottomY_val} x2={leftCrownX - 5} y2={bottomY_val} stroke="#0ea5e9" strokeWidth="2" />
                    </g>

                    {/* 4. Talud (En el aire, estilo plano técnico) */}
                    <g className="dimension-group opacity-70">
                        <polyline points={`${rightCrownX - 20},${waterLevelY + 40} ${rightCrownX},${waterLevelY + 40} ${rightCrownX},${waterLevelY + 20}`} fill="none" stroke="#64748b" strokeWidth="1.5" />
                        <text x={rightCrownX - 10} y={waterLevelY + 52} fill="#64748b" fontSize="8" fontWeight="900" textAnchor="middle">z = {talud}</text>
                        <text x={rightCrownX + 8} y={waterLevelY + 30} fill="#64748b" fontSize="8" fontWeight="900" textAnchor="start">1</text>
                    </g>

                    {/* Superficie de Agua */}
                    <line
                        x1={leftCrownX + (leftBottomX - leftCrownX) * 0.4 - 15}
                        y1={waterLevelY}
                        x2={rightCrownX - (rightCrownX - rightBottomX) * 0.4 + 15}
                        y2={waterLevelY}
                        stroke="#0ea5e9"
                        strokeWidth="3"
                        strokeDasharray="8 4"
                    />

                    {/* VERTICALES DE MEDICIÓN (EQUIDISTANTES) */}
                    {dobelas.map((dob, idx) => {
                        const isActive = activeDobelaIndex === idx;
                        const isHoverable = onDobelaSelect !== undefined;

                        return (
                            <g
                                key={idx}
                                onClick={() => onDobelaSelect && onDobelaSelect(idx)}
                                className={clsx("transition-all duration-300", isHoverable && "cursor-pointer hover:opacity-100", isActive ? "opacity-100" : "opacity-25")}
                            >
                                {/* Línea de Vertical Reforzada */}
                                <line
                                    x1={dob.cx}
                                    y1={dob.topY}
                                    x2={dob.cx}
                                    y2={dob.bottomY}
                                    stroke={isActive ? "#fbbf24" : "#475569"}
                                    strokeWidth={isActive ? "4" : "2"}
                                    strokeDasharray={isActive ? "none" : "5 3"}
                                />

                                {/* Marcadores de Profundidad Molinete */}
                                {isActive && (
                                    <g filter="url(#glow)">
                                        {[0.2, 0.6, 0.8].map((depthFact, mIdx) => {
                                            const depthY = dob.topY + (dob.bottomY - dob.topY) * depthFact;
                                            const meterDepth = activeTirante * depthFact;
                                            return (
                                                <g key={mIdx}>
                                                    <circle cx={dob.cx} cy={depthY} r="3" fill="#fbbf24" />
                                                    <rect x={dob.cx + 10} y={depthY - 8} width="45" height="16" rx="3" fill="#0f172a" opacity="0.9" />
                                                    <text x={dob.cx + 32.5} y={depthY + 4} fill="#fbbf24" fontSize="8" fontWeight="900" textAnchor="middle">
                                                        {meterDepth.toFixed(2)}m
                                                    </text>
                                                    <line x1={dob.cx} y1={depthY} x2={dob.cx + 10} y2={depthY} stroke="#fbbf24" strokeWidth="1" opacity="0.5" />
                                                </g>
                                            );
                                        })}

                                        {/* Placa de datos XL/XR (Evita empalme con Plantilla) */}
                                        <g>
                                            <rect x={dob.cx - 50} y={dob.bottomY + 10} width="100" height="20" rx="4" fill="#1e293b" stroke="#334155" strokeWidth="1" />
                                            <text x={dob.cx} y={dob.bottomY + 23} textAnchor="middle" fill="#fbbf24" fontSize="8" fontWeight="900">
                                                L:{activeX.toFixed(2)}m | R:{(espejoDiseno - activeX).toFixed(2)}m
                                            </text>
                                        </g>
                                    </g>
                                )}

                                {/* Etiqueta V-N */}
                                <text x={dob.cx} y={dob.topY - 12} textAnchor="middle" fill={isActive ? "#fbbf24" : "#64748b"} fontSize={isActive ? "11" : "9"} fontWeight="900">
                                    V{idx + 1}
                                </text>

                                <rect x={dob.cx - 20} y={dob.topY - 20} width="40" height={dob.bottomY - dob.topY + 50} fill="transparent" />
                            </g>
                        );
                    })}
                </svg>
            </div>
        </div>
    );
};
