import Image from 'next/image';
import startupBrand from '@/assets/startup-brand.webp';

export default function AppLoadingScreen() {
  return (
    <div role="status" aria-busy="true" className="fixed inset-x-0 top-0 flex h-[100dvh] justify-center bg-[#f5f2fd] p-6">
      <Image
        src={startupBrand}
        alt=""
        priority
        unoptimized
        className="h-full w-full max-w-[240px] object-contain"
      />
      <span className="sr-only">로딩중...</span>
    </div>
  );
}
