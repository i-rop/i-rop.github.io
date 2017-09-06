//   <!-- Navigation -->
//   <nav class="navbar">
//   <div class="container-fluid">
//       <!-- Brand and toggle get grouped for better mobile display -->
//       <div class="navbar-header">
//         <button type="button" class="navbar-toggle collapsed" data-toggle="collapse" data-target="#bs-example-navbar-collapse-1" aria-expanded="false">
//           <span class="sr-only">Toggle navigation</span>
//           <span class="icon-bar"></span>
//           <span class="icon-bar"></span>
//           <span class="icon-bar"></span>
//         </button>
//         <a class="navbar-brand" href="#"></a>
//       </div>
//
//       <!-- Collect the nav links, forms, and other content for toggling -->
//       <div class="collapse navbar-collapse" id="bs-example-navbar-collapse-1">
//
//         <ul class="nav navbar-nav navbar-right">
//            <li class><a href="http://127.0.0.1:65230/main.html">Home</a></li>
//            <li class><a href="http://127.0.0.1:65230/people.html">People </a></li>
            
//            <li class><a href="http://127.0.0.1:65230/publications.html">Publications</a></li>
//            <li class="dropdown">
//            <a href="#" class="dropdown-toggle" data-toggle="dropdown" role="button" aria-haspopup="true" aria-expanded="false">News<span class="caret"></span></a>
//             <ul class="dropdown-menu">
//               <li><a href="#">Action</a></li>
//               <li><a href="#">Another action</a></li>
//               <li><a href="#">Something else here</a></li>
//               <li role="separator" class="divider"></li>
//               <li><a href="#">Separated link</a></li>
//             </ul>
//           </li>
//         </ul>
//       </div><!-- /.navbar-collapse -->
//   </div><!-- /.container-fluid -->
//   </nav>

(function() {

    var links = [
        $('<li class><a href="index.html">Home</a></li>'),
        $('<li class><a href="people.html">People</a></li>'),
         $('<li class><a href="funding.html">Funding</a></li>'),
        $('<li class><a href="publications.html">Publications</a></li>'),
        $('<li class="dropdown"><a href="#" class="dropdown-toggle" data-toggle="dropdown" role="button" aria-haspopup="true" aria-expanded="false">Tools<span class="caret"></span></a></li>'),
    ];

    var menuitems = [
        $('<li><a href="forResearcher.html">Researchers: Resources</a></li>'),
        $('<li><a href="cliniciansExamples.html">Clinicians: Examples</a></li>'),
        $('<li><a href="cliniciansSeverityScale.html">Clinicians: Severity Scale & App</a></li>'),
        // $('<li role="separator" class="divider"></li>'),
        // $('<li><a href="#">Separated link</a></li>'),
    ];

    var menu = $('<ul class="dropdown-menu">');
    menu.append(menuitems);

    links[links.length-1].append(menu);

    var list = $('<ul class="nav navbar-nav navbar-right"></ul>');
    links.forEach(function(link) {
        list.append(link);
    });

    var container = $('<div class="container-fluid">');
    container.append(list);

    $('#top-navbar').append(container);

})();
