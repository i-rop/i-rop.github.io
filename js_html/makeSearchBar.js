

// code below replaces this html:

//   <div class="container-container-fluid">
//       <div class="row">
//           <div class="col-lg-12 text-right"> <p class="pull-right">Contact &middot; Log In </p>
//               <div class="span12"> 
//                   <form id="custom-search-form" class="form-search form-horizontal pull-right">
//                       <div class="input-append span12">
//                           <input type="text" class="search-query mac-style" placeholder="Search">
//                           <button type="submit" class="btn"><i class="icon-search"></i></button>
//                       </div>
//                   </form>
//               </div>
//           </div>
//       </div>
//   </div>
//

(function() {  // anonymous function to not pollute the DOM (global namespace)

    var inp = $('<input type="text" class="search-query mac-style" placeholder="Search">');
    var btn = $('<button type="submit" class="btn"><i class="icon-search"></i></button>');
    
    var inp_div = $('<div class="input-append span12">');
    inp_div.append(inp).append(btn);
    
    var form = $('<form id="custom-search-form" class="form-search form-horizontal pull-right">');
    form.append(inp_div);

    var span = $('<div class="span12"> ');
    span.append(form);

    var cntct = $('<div class="col-lg-12 text-right"> <p class="pull-right">Contact &middot; Log In </p>');
    cntct.append(span);
    
    var row = $('<div class="row">');
    row.append(cntct);
    
    var cntr = $('<div class="container-container-fluid">');
    cntr.append(row);
    
    $("#search-bar").append(cntr);
            
})();