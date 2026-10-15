import Image from 'next/image';
import startupBrand from '@/assets/startup-brand.webp';

export default function AppLoadingScreen() {
  return (
    <div role="status" aria-busy="true" className="fixed inset-x-0 top-0 h-[100dvh] bg-[#f5f2fd]">
      <Image
        src={startupBrand}
        alt=""
        priority
        unoptimized
        className="h-full w-full object-contain p-6"
      />
      <span className="sr-only">로딩중...</span>
    </div>
  );
}
