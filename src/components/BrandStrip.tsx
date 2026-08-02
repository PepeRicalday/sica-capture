const BrandStrip = ({ className = 'mb-2' }: { className?: string }) => (
    <div className={`flex items-center gap-1.5 relative z-10 ${className}`}>
        <img src="/logo-srl.png" alt="" className="w-4 h-4 object-contain rounded-sm bg-white/90 p-0.5" />
        <span className="text-[9px] font-black text-slate-400 tracking-[0.2em] uppercase">
            Unidad Conchos
        </span>
    </div>
);

export default BrandStrip;
