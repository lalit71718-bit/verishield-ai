// StudyBridge front end. All college, cost and mentor data below is sample data for the demo.
(function () {
  var CITIES = {
    India: ['Bangalore', 'Chennai', 'Dehradun', 'Chandigarh', 'Delhi'],
    Nepal: ['Kathmandu', 'Pokhara', 'Biratnagar'],
    Bangladesh: ['Dhaka', 'Chittagong', 'Sylhet', 'Rajshahi']
  };
  var COURSES = {
    Medical: ['MBBS', 'BDS (Dental)', 'Nursing', 'Pharmacy', 'Physiotherapy'],
    Engineering: ['Computer Science', 'AI and Data Science', 'Civil', 'Mechanical', 'Electrical', 'Electronics'],
    Management: ['BBA / MBA General', 'Finance', 'Marketing', 'Human Resources', 'Hospital Management'],
    Law: ['LLB / LLM', 'Corporate Law', 'Criminal Law'],
    Journalism: ['Print and Digital', 'Broadcast', 'Mass Communication'],
    'Political Science': ['Political Science', 'International Relations', 'Public Policy']
  };
  var U = 'Undergrad', M = 'Masters', P = 'PhD';
  // [name, country, city, courses, levels, yearly cost in USD (tuition + living, sample)]
  var COLLEGES = [
    ['RV College of Engineering', 'India', 'Bangalore', ['Engineering'], [U, M, P], 5200],
    ['Christ University', 'India', 'Bangalore', ['Management', 'Law', 'Journalism', 'Political Science'], [U, M, P], 4400],
    ["St. John's Medical College", 'India', 'Bangalore', ['Medical'], [U, M], 14500],
    ['National Law School of India University', 'India', 'Bangalore', ['Law'], [U, M, P], 5600],
    ['IIT Madras', 'India', 'Chennai', ['Engineering', 'Management'], [U, M, P], 4800],
    ['SRM Institute of Science and Technology', 'India', 'Chennai', ['Engineering', 'Medical', 'Management'], [U, M, P], 7200],
    ['Asian College of Journalism', 'India', 'Chennai', ['Journalism'], [M], 7000],
    ['Madras Christian College', 'India', 'Chennai', ['Political Science', 'Journalism'], [U, M], 2200],
    ['UPES', 'India', 'Dehradun', ['Engineering', 'Law', 'Management'], [U, M, P], 6400],
    ['Graphic Era University', 'India', 'Dehradun', ['Engineering', 'Management'], [U, M, P], 4200],
    ['Himalayan Institute of Medical Sciences', 'India', 'Dehradun', ['Medical'], [U, M], 16000],
    ['Doon University', 'India', 'Dehradun', ['Political Science', 'Journalism', 'Management'], [U, M, P], 1900],
    ['Panjab University', 'India', 'Chandigarh', ['Law', 'Political Science', 'Journalism', 'Engineering', 'Management'], [U, M, P], 2400],
    ['Chandigarh University', 'India', 'Chandigarh', ['Engineering', 'Management', 'Law', 'Journalism'], [U, M, P], 4600],
    ['PGIMER', 'India', 'Chandigarh', ['Medical'], [M, P], 3200],
    ['University of Delhi', 'India', 'Delhi', ['Political Science', 'Law', 'Journalism', 'Management'], [U, M, P], 2100],
    ['Jawaharlal Nehru University', 'India', 'Delhi', ['Political Science'], [M, P], 1800],
    ['IIT Delhi', 'India', 'Delhi', ['Engineering', 'Management'], [U, M, P], 5000],
    ['AIIMS New Delhi', 'India', 'Delhi', ['Medical'], [U, M, P], 3000],
    ['Indian Institute of Mass Communication', 'India', 'Delhi', ['Journalism'], [M], 3400],
    ['Institute of Medicine, Tribhuvan University', 'Nepal', 'Kathmandu', ['Medical'], [U, M, P], 9500],
    ['Pulchowk Campus (IOE)', 'Nepal', 'Kathmandu', ['Engineering'], [U, M, P], 2800],
    ['Kathmandu University School of Management', 'Nepal', 'Kathmandu', ['Management'], [U, M, P], 3800],
    ['Nepal Law Campus', 'Nepal', 'Kathmandu', ['Law'], [U, M], 1500],
    ['Tribhuvan University', 'Nepal', 'Kathmandu', ['Political Science', 'Journalism', 'Management'], [U, M, P], 1400],
    ['Manipal College of Medical Sciences', 'Nepal', 'Pokhara', ['Medical'], [U, M], 13000],
    ['Gandaki Medical College', 'Nepal', 'Pokhara', ['Medical'], [U], 11500],
    ['Pokhara University', 'Nepal', 'Pokhara', ['Engineering', 'Management'], [U, M, P], 2900],
    ['Prithvi Narayan Campus', 'Nepal', 'Pokhara', ['Political Science', 'Management', 'Journalism'], [U, M], 1200],
    ['Nobel Medical College', 'Nepal', 'Biratnagar', ['Medical'], [U, M], 12000],
    ['Birat Medical College', 'Nepal', 'Biratnagar', ['Medical'], [U], 11000],
    ['Purbanchal University', 'Nepal', 'Biratnagar', ['Engineering', 'Management', 'Law'], [U, M], 2300],
    ['Dhaka Medical College', 'Bangladesh', 'Dhaka', ['Medical'], [U, M], 2600],
    ['Bangladesh Medical College', 'Bangladesh', 'Dhaka', ['Medical'], [U], 9000],
    ['BUET', 'Bangladesh', 'Dhaka', ['Engineering'], [U, M, P], 2000],
    ['University of Dhaka', 'Bangladesh', 'Dhaka', ['Law', 'Political Science', 'Journalism', 'Management'], [U, M, P], 1800],
    ['North South University', 'Bangladesh', 'Dhaka', ['Management', 'Engineering', 'Law'], [U, M], 5500],
    ['Chittagong Medical College', 'Bangladesh', 'Chittagong', ['Medical'], [U, M], 2500],
    ['CUET', 'Bangladesh', 'Chittagong', ['Engineering'], [U, M, P], 1900],
    ['University of Chittagong', 'Bangladesh', 'Chittagong', ['Law', 'Political Science', 'Journalism', 'Management'], [U, M, P], 1600],
    ['Sylhet MAG Osmani Medical College', 'Bangladesh', 'Sylhet', ['Medical'], [U, M], 2400],
    ['Shahjalal University of Science and Technology', 'Bangladesh', 'Sylhet', ['Engineering', 'Political Science', 'Management'], [U, M, P], 1700],
    ['Rajshahi Medical College', 'Bangladesh', 'Rajshahi', ['Medical'], [U, M], 2300],
    ['RUET', 'Bangladesh', 'Rajshahi', ['Engineering'], [U, M, P], 1800],
    ['University of Rajshahi', 'Bangladesh', 'Rajshahi', ['Law', 'Political Science', 'Journalism', 'Management'], [U, M, P], 1500]
  ];
  var MENTORS = [
    ['Aarav S.', 'From Nepal', 'MBBS, 4th year', 'Chennai, India', 'Hostel life, exam pattern, first-year costs', 'y'],
    ['Nusrat J.', 'From Bangladesh', 'B.Tech Computer Science, 3rd year', 'Bangalore, India', 'Student visa, internships, scholarships', 'b'],
    ['Rohit K.', 'From India', 'MBBS, intern', 'Dhaka, Bangladesh', 'Admission paperwork, licensing exam prep', 'p'],
    ['Sneha T.', 'From India', 'MBBS, 3rd year', 'Pokhara, Nepal', 'Fee instalments, food, travel home', 'g'],
    ['Bibek R.', 'From Nepal', 'MBA Finance, 2nd year', 'Delhi, India', 'NOC process, part-time rules, placements', 'o'],
    ['Farhan A.', 'From Bangladesh', 'LLB, final year', 'Chandigarh, India', 'Entrance tests, moot courts, renting a PG', 'v']
  ];
  var FX = { USD: [1, '$'], INR: [88, '₹'], NPR: [141, 'NPR '], BDT: [122, 'BDT '] }; // approximate rates

  var $ = function (id) { return document.getElementById(id); };
  var state = { country: 'India', level: U, cur: 'INR' };

  function money(usd) {
    var f = FX[state.cur], v = usd * f[0];
    if (state.cur === 'INR' && v >= 100000) return '₹' + (v / 100000).toFixed(1) + ' lakh';
    var step = v >= 100000 ? 1000 : 100;
    return f[1] + (Math.round(v / step) * step).toLocaleString('en-IN');
  }
  function fill(sel, items, first) {
    sel.innerHTML = (first ? '<option value="">' + first + '</option>' : '') +
      items.map(function (x) { return '<option>' + x + '</option>'; }).join('');
  }

  function render() {
    var course = $('f-course').value, city = $('f-city').value, budget = +$('f-budget').value;
    $('budget-val').textContent = money(budget);
    var list = COLLEGES.filter(function (c) {
      return c[1] === state.country && c[3].indexOf(course) >= 0 && c[4].indexOf(state.level) >= 0 && (!city || c[2] === city);
    }).map(function (c) {
      var r = c[5] / budget;
      return { c: c, rank: r <= 1 ? 0 : r <= 1.25 ? 1 : 2 };
    }).sort(function (a, b) { return a.rank - b.rank || a.c[5] - b.c[5]; });

    var fit = list.filter(function (x) { return x.rank === 0; }).length;
    $('res-count').textContent = list.length + (list.length === 1 ? ' college' : ' colleges') + ' found';
    $('res-sub').textContent = list.length ? fit + ' within your budget · ' + $('f-branch').value + ' · ' + state.level : '';
    var labels = [['WITHIN BUDGET', 'g'], ['STRETCH', 'o'], ['ABOVE BUDGET', 'p']];
    $('results').innerHTML = list.length ? list.map(function (x, i) {
      var c = x.c, l = labels[x.rank];
      return '<article class="note college ' + l[1] + (i % 3 === 1 ? ' pin' : '') + '">' +
        '<span class="mono">' + c[2] + ' · ' + c[1] + '</span>' +
        '<h3>' + c[0] + '</h3>' +
        '<p>' + c[3].join(', ') + '</p>' +
        '<div class="row"><span class="mono">Per year, with living</span><span class="cost">' + money(c[5]) + '</span></div>' +
        '<div class="foot"><span class="status">' + l[0] + '</span>' +
        '<a class="btn small" href="#talk" data-about="' + c[0] + '">Ask about this</a></div></article>';
    }).join('') :
      '<div class="empty"><h3>No match in this city yet</h3><p>Try "Any city", another level, or tell us what you need and a counsellor will look for you.</p></div>';
  }

  function setCountry() {
    fill($('f-city'), CITIES[state.country], 'Any city');
  }
  function setCourse() { fill($('f-branch'), COURSES[$('f-course').value]); }

  fill($('f-course'), Object.keys(COURSES));
  setCourse(); setCountry();

  document.querySelectorAll('input[name=country]').forEach(function (r) {
    r.addEventListener('change', function () { state.country = r.value; setCountry(); render(); });
  });
  document.querySelectorAll('input[name=level]').forEach(function (r) {
    r.addEventListener('change', function () { state.level = r.value; render(); });
  });
  $('f-course').addEventListener('change', function () { setCourse(); render(); });
  ['f-branch', 'f-city'].forEach(function (id) { $(id).addEventListener('change', render); });
  $('f-budget').addEventListener('input', render);
  $('cur').addEventListener('change', function () { state.cur = this.value; render(); });

  $('mentors').innerHTML = MENTORS.map(function (m, i) {
    var ini = m[0].split(' ').map(function (w) { return w[0]; }).join('');
    return '<article class="note mentor ' + m[5] + (i % 3 === 0 ? ' pin' : '') + '">' +
      '<div class="who"><span class="avatar">' + ini + '</span><div><h3>' + m[0] + '</h3><span class="mono">' + m[1] + '</span></div></div>' +
      '<p><strong>' + m[2] + '</strong><br>' + m[3] + '</p><p>Ask about: ' + m[4] + '</p>' +
      '<div class="foot"><span class="mono">Sample profile</span>' +
      '<a class="btn small" href="#talk" data-about="a call with ' + m[0] + '">Request a call</a></div></article>';
  }).join('');

  document.addEventListener('click', function (e) {
    var a = e.target.closest('[data-about]');
    if (a) $('c-msg').value = 'I would like to know more about ' + a.getAttribute('data-about') + '.';
  });

  $('lead').addEventListener('submit', function (e) {
    e.preventDefault();
    var d = { name: $('c-name').value, phone: $('c-phone').value, home: $('c-home').value, msg: $('c-msg').value, at: new Date().toISOString() };
    try {
      var all = JSON.parse(localStorage.getItem('sb-leads') || '[]');
      all.push(d); localStorage.setItem('sb-leads', JSON.stringify(all));
    } catch (err) { /* storage unavailable; the confirmation below still applies */ }
    var done = $('done');
    done.hidden = false;
    done.textContent = 'Thanks, ' + d.name.split(' ')[0] + '. Your request is saved on this device only. This demo is not connected to a server yet, so no counsellor has been notified.';
    this.reset();
  });

  render();
})();
