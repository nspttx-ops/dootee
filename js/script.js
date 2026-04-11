// URL ของไฟล์ CSV (อ้างอิงจากโฟลเดอร์ใน GitHub)
const csvUrl = 'data/movies.csv';
let allMovies = []; // ตัวแปรเก็บข้อมูลหนังทั้งหมด

// ใช้ PapaParse อ่านไฟล์ CSV
Papa.parse(csvUrl, {
    download: true,
    header: true, // กำหนดว่าแถวแรกคือชื่อคอลัมน์
    skipEmptyLines: true,
    complete: function(results) {
        allMovies = results.data;
        displayMovies(allMovies); // แสดงหนังทั้งหมดเมื่อโหลดเสร็จ
    },
    error: function(err) {
        document.getElementById('movie-container').innerHTML = '<p>เกิดข้อผิดพลาดในการโหลดข้อมูล</p>';
        console.error(err);
    }
});

// ฟังก์ชันสำหรับแสดงข้อมูลหนังบนหน้าเว็บ
function displayMovies(movies) {
    const container = document.getElementById('movie-container');
    container.innerHTML = ''; // ล้างข้อมูลเก่าออกก่อน

    if (movies.length === 0) {
        container.innerHTML = '<p>ไม่พบข้อมูลหนัง</p>';
        return;
    }

    movies.forEach(movie => {
        // สร้างการ์ด HTML สำหรับหนังแต่ละเรื่อง
        const card = document.createElement('div');
        card.className = 'movie-card';
        
        card.innerHTML = `
            <h3>${movie.Title_TH}</h3>
            <p><strong>ชื่ออังกฤษ:</strong> ${movie.Title}</p>
            <p><strong>ปี:</strong> ${movie.Year} | <strong>แนว:</strong> ${movie.Genre}</p>
            <p><strong>ประเทศ:</strong> ${movie.Country} | <strong>พากย์:</strong> ${movie.Dubs}</p>
            <span class="platform-tag">${movie.Platforms}</span>
        `;
        
        container.appendChild(card);
    });
}

// ฟังก์ชันสำหรับกรองแพลตฟอร์มเมื่อกดปุ่ม
function filterMovies(platform) {
    if (platform === 'All') {
        displayMovies(allMovies);
    } else {
        // กรองเฉพาะหนังที่มีชื่อแพลตฟอร์มตรงกับที่กด (ใช้ includes เผื่อหนังเรื่องนึงมีหลายแพลตฟอร์ม)
        const filtered = allMovies.filter(movie => 
            movie.Platforms && movie.Platforms.includes(platform)
        );
        displayMovies(filtered);
    }
}
