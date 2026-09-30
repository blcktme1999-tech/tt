
window.addEventListener('load', function () {
    const lis = document.querySelectorAll('.menu>ul>li:not(:has(.toplink))'); // 第一層選單
    lis.forEach(li => {
        li.addEventListener('keyup', function (e) {
            if (e.keyCode === 9) { // tab
                for (let i = 0; i < lis.length; i++) {
                    // 如果是當前選單且有子選單則顯示，否則隱藏
                    if (lis[i] === li) {
                        if (lis[i].children[1]) lis[i].children[1].style.display = 'flex';
                    } else {
                        if (lis[i].children[1]) lis[i].children[1].style.display = '';
                    }
                }
            }
        })
    })
});