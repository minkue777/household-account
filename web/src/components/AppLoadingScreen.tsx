import Image from 'next/image';
import startupBrand from '@/assets/startup-brand.jpg';

export default function AppLoadingScreen() {
  return (
    <div role="status" aria-busy="true" className="fixed inset-x-0 top-0 h-[100dvh] bg-[#f8f5fe]">
      <Image
        src={startupBrand}
        alt=""
        priority
        unoptimized
        className="app-startup-artwork h-full w-full object-contain"
      />
      <span className="sr-only">로딩중...</span>
    </div>
  );
}
