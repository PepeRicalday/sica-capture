const BrandStrip = ({ className = 'mb-2' }: { className?: string }) => (
    <div className={`flex items-center gap-1.5 relative z-10 ${className}`}>
        <img src="/sica005-emblema.svg" alt="" width={28} height={28} className="w-7 h-7 object-contain shrink-0" />
        <span className="font-display text-[13px] font-extrabold text-white tracking-wide">
            SICA 005
        </span>
    </div>
);

export default BrandStrip;
