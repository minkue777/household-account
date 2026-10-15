import Image from 'next/image';
import startupBrand from '@/assets/startup-brand.jpg';

export default function AppLoadingScreen() {
  return (
    <div role="status" aria-busy="true" className="fixed inset-0 bg-[#f8f5fe]">
      <Image
        src={startupBrand}
        alt=""
        priority
        unoptimized
        className="h-full w-full object-contain"
      />
      <span className="sr-only">로딩중...</span>
    </div>
  );
}
