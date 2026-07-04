// ========================================
// Blog 主題分類輪播模組
// Blog Theme Carousel Module
// ========================================

class BlogThemeCarousel {
  constructor() {
    this.currentIndex = 0;
    this.slideCount = 5;
    this.prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    
    this.container = document.getElementById('blogThemeCarousel');
    this.slides = document.querySelectorAll('.yr-blog-carousel__slide');
    this.dotsContainer = document.getElementById('blogCarouselDots');
    this.prevBtn = document.getElementById('blogCarouselPrev');
    this.nextBtn = document.getElementById('blogCarouselNext');
    
    if (!this.container || this.slides.length === 0) return;
    
    this.init();
  }

  init() {
    this.setupDots();
    this.bindEvents();
    this.updateCarousel();
  }

  setupDots() {
    if (!this.dotsContainer) return;
    
    this.dotsContainer.innerHTML = '';
    for (let i = 0; i < this.slideCount; i++) {
      const dot = document.createElement('button');
      dot.type = 'button';
      dot.classList.add('yr-blog-carousel__dot');
      dot.setAttribute('aria-label', `切換到主題 ${i + 1}`);
      if (i === 0) dot.classList.add('active');
      dot.addEventListener('click', () => this.goToSlide(i));
      this.dotsContainer.appendChild(dot);
    }
  }

  bindEvents() {
    if (this.prevBtn) {
      this.prevBtn.addEventListener('click', () => this.prev());
    }
    
    if (this.nextBtn) {
      this.nextBtn.addEventListener('click', () => this.next());
    }
    
    // 鍵盤支援 - 只在輪播按鈕或按鈕被 focus 時啟用
    document.addEventListener('keydown', (e) => {
      const activeElement = document.activeElement;
      
      // 檢查是否在文本輸入框中
      if (activeElement && (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA')) {
        return;
      }
      
      // 檢查是否在輪播元件中或輪播按鈕被 focus
      const inCarousel = this.container && (
        this.container.contains(activeElement) || 
        activeElement === this.prevBtn || 
        activeElement === this.nextBtn
      );
      
      if (inCarousel) {
        if (e.key === 'ArrowLeft') {
          e.preventDefault();
          this.prev();
        }
        if (e.key === 'ArrowRight') {
          e.preventDefault();
          this.next();
        }
      }
    });


    // 觸控滑動支援
    this.setupTouchSupport();
  }

  setupTouchSupport() {
    let touchStartX = 0;
    let touchEndX = 0;

    this.container.addEventListener('touchstart', (e) => {
      touchStartX = e.changedTouches[0].screenX;
    }, false);

    this.container.addEventListener('touchend', (e) => {
      touchEndX = e.changedTouches[0].screenX;
      this.handleSwipe();
    }, false);

    const handleSwipe = () => {
      const diff = touchStartX - touchEndX;
      const threshold = 50;

      if (Math.abs(diff) > threshold) {
        if (diff > 0) {
          this.next();
        } else {
          this.prev();
        }
      }
    };

    this.handleSwipe = handleSwipe;
  }

  goToSlide(index) {
    this.currentIndex = (index + this.slideCount) % this.slideCount;
    this.updateCarousel();
  }

  prev() {
    this.currentIndex = (this.currentIndex - 1 + this.slideCount) % this.slideCount;
    this.updateCarousel();
  }

  next() {
    this.currentIndex = (this.currentIndex + 1) % this.slideCount;
    this.updateCarousel();
  }

  updateCarousel() {
    // 更新 slide 可見性
    this.slides.forEach((slide, index) => {
      if (index === this.currentIndex) {
        slide.setAttribute('aria-hidden', 'false');
      } else {
        slide.setAttribute('aria-hidden', 'true');
      }
    });

    // 更新圓點
    const dots = this.dotsContainer?.querySelectorAll('.yr-blog-carousel__dot');
    if (dots) {
      dots.forEach((dot, index) => {
        if (index === this.currentIndex) {
          dot.classList.add('active');
        } else {
          dot.classList.remove('active');
        }
      });
    }
  }
}

// 初始化輪播
let _carouselInstance = null;

function _initCarousel() {
  if (!_carouselInstance) {
    _carouselInstance = new BlogThemeCarousel();
  }
}

// 在 DOM 準備好時初始化
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _initCarousel);
} else {
  _initCarousel();
}

console.log('✓ blog-carousel.js 已載入 blog-carousel.js loaded');
